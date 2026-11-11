/**
 * Testes da trava de SSRF (rede-segura.mjs). Node puro, sem dependência.
 *   node --test rede-segura.test.mjs
 *
 * Provam o que a auditoria do ticket pediu: IPv6 que embute IPv4 (mapeado,
 * NAT64, 6to4), o não-roteável (::, 0.0.0.0, link-local de metadados), o
 * redirecionamento 302 para dentro, e que um destino público segue passando.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import {
  classificarIP, ipBloqueado, conferirUrl, lookupFixo,
  criarRedeSegura, ErroSSRF,
} from './rede-segura.mjs';

/* ── 1. CLASSIFICAÇÃO DE ENDEREÇO ─────────────────────────────────────────── */

// os casos que a regra antiga (só IPv4 + alguns prefixos de texto) deixava passar
const INTERNOS = [
  ['::ffff:127.0.0.1', 'IPv4 mapeado — loopback'],
  ['::ffff:7f00:1',    'IPv4 mapeado em hexadecimal — o mesmo 127.0.0.1'],
  ['::ffff:169.254.169.254', 'IPv4 mapeado — metadados de nuvem'],
  ['64:ff9b::7f00:1',  'NAT64 embute 127.0.0.1'],
  ['64:ff9b::a00:1',   'NAT64 embute 10.0.0.1'],
  ['2002:7f00:1::',    '6to4 embute 127.0.0.1'],
  ['2002:a9fe:a9fe::', '6to4 embute 169.254.169.254'],
  ['::',               'não especificado'],
  ['::1',              'loopback IPv6'],
  ['0.0.0.0',          '"esta rede"'],
  ['127.0.0.1',        'loopback IPv4'],
  ['127.1.2.3',        'loopback, resto do /8'],
  ['10.0.0.1',         'privado 10/8'],
  ['10.255.255.255',   'privado 10/8, fim'],
  ['172.16.0.1',       'privado 172.16/12'],
  ['172.31.255.255',   'privado 172.16/12, fim'],
  ['192.168.1.1',      'privado 192.168/16'],
  ['169.254.169.254',  'link-local — endpoint de metadados'],
  ['100.64.0.1',       'CGNAT'],
  ['198.18.0.1',       'faixa de teste de desempenho'],
  ['224.0.0.1',        'multicast'],
  ['239.255.255.250',  'multicast (SSDP)'],
  ['240.0.0.1',        'reservado'],
  ['255.255.255.255',  'broadcast'],
  ['fc00::1',          'ULA fc00::/7'],
  ['fd12:3456::1',     'ULA, metade fd'],
  ['fe80::1',          'link-local IPv6'],
  ['fec0::1',          'site-local obsoleto'],
  ['ff02::1',          'multicast IPv6'],
  ['2001:db8::1',      'documentação'],
  ['[::ffff:127.0.0.1]', 'com colchetes, como vem da URL'],
  ['fe80::1%eth0',     'link-local com zona'],
];

for (const [ip, oque] of INTERNOS) {
  test(`bloqueia ${ip} (${oque})`, () => {
    const c = classificarIP(ip);
    assert.equal(c.bloqueado, true, `${ip} deveria ser bloqueado — motivo dado: ${c.motivo}`);
    assert.equal(ipBloqueado(ip), true);
  });
}

// o outro lado: endereço público de verdade NÃO pode ser barrado
const PUBLICOS = [
  ['8.8.8.8', 'DNS público'],
  ['1.1.1.1', 'DNS público'],
  ['93.184.216.34', 'IPv4 roteável comum'],
  ['200.147.67.142', 'IPv4 roteável (BR)'],
  ['172.15.0.1', 'logo antes do bloco privado 172.16/12'],
  ['172.32.0.1', 'logo depois do bloco privado 172.16/12'],
  ['100.63.255.255', 'logo antes do CGNAT'],
  ['100.128.0.1', 'logo depois do CGNAT'],
  ['11.0.0.1', 'vizinho público do 10/8'],
  ['126.255.255.255', 'logo antes do 127/8'],
  ['128.0.0.1', 'logo depois do 127/8'],
  ['2001:4860:4860::8888', 'IPv6 público (Google)'],
  ['2606:4700:4700::1111', 'IPv6 público (Cloudflare)'],
  ['2800:3f0::1', 'IPv6 público (LACNIC)'],
  ['::ffff:93.184.216.34', 'IPv4 mapeado de endereço PÚBLICO — deve passar'],
  ['64:ff9b::808:808', 'NAT64 de 8.8.8.8 — público, deve passar'],
  ['2002:5db8:d822::', '6to4 de 93.184.216.34 — público, deve passar'],
];

for (const [ip, oque] of PUBLICOS) {
  test(`deixa passar ${ip} (${oque})`, () => {
    const c = classificarIP(ip);
    assert.equal(c.bloqueado, false, `${ip} deveria passar — foi barrado como: ${c.motivo}`);
  });
}

test('texto que não é IP é tratado como interno (na dúvida, recusa)', () => {
  for (const lixo of ['', 'localhost', 'não-é-ip', '999.1.1.1', '127.0.0.256', undefined, null]) {
    assert.equal(classificarIP(lixo).bloqueado, true, `"${lixo}" deveria ser recusado`);
  }
});

/* ── 2. conferirUrl: barra o que dá para barrar sem tocar na rede ──────────── */

test('conferirUrl recusa protocolo que não é http/https', () => {
  for (const u of ['file:///etc/passwd', 'ftp://x/y', 'gopher://a', 'data:text/html,x'])
    assert.throws(() => conferirUrl(u), ErroSSRF);
});

test('conferirUrl recusa IP literal interno, incluindo IPv6 mapeado', () => {
  for (const u of ['http://127.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://[::1]/', 'http://0.0.0.0/', 'https://169.254.169.254/latest/meta-data/'])
    assert.throws(() => conferirUrl(u), ErroSSRF, `deveria barrar ${u}`);
});

test('conferirUrl recusa credenciais embutidas na URL', () => {
  assert.throws(() => conferirUrl('http://user:senha@exemplo.com/'), ErroSSRF);
});

test('conferirUrl aceita host público e devolve URL', () => {
  const u = conferirUrl('https://exemplo.com.br/caminho?q=1');
  assert.equal(u.hostname, 'exemplo.com.br');
});

/* ── 3. lookupFixo: só responde endereços já verificados ───────────────────── */

test('lookupFixo recusa ao receber um endereço interno', () => {
  assert.throws(() => lookupFixo([{ address: '127.0.0.1', family: 4 }]), ErroSSRF);
});

test('lookupFixo responde o endereço público fixado, sem novo DNS', async () => {
  const lk = lookupFixo([{ address: '93.184.216.34', family: 4 }]);
  const [addr, fam] = await new Promise((ok, no) => lk('qualquer.coisa', {}, (e, a, f) => e ? no(e) : ok([a, f])));
  assert.equal(addr, '93.184.216.34');
  assert.equal(fam, 4);
});

/* ── 4. fetchSeguro ponta a ponta, com servidores locais ──────────────────────
   hostsDeTeste trata um NOME como público apontando-o para o servidor local.
   É assim que simulamos "um site público" sem sair para a internet. */

async function subirServidor(handler) {
  const srv = http.createServer(handler);
  await once(srv.listen(0, '127.0.0.1'), 'listening');
  return { srv, porta: srv.address().port, fechar: () => srv.close() };
}

test('fetchSeguro busca um destino público (via nome) e lê o corpo', async () => {
  const { porta, fechar } = await subirServidor((q, s) => s.end('conteúdo público'));
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'site-publico.teste': '127.0.0.1' } });
    const r = await rede.fetchSeguro(`http://site-publico.teste:${porta}/pagina`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'conteúdo público');
    assert.equal(r.url, `http://site-publico.teste:${porta}/pagina`);
  } finally { fechar(); }
});

test('fetchSeguro RECUSA o 302 que redireciona para 127.0.0.1', async () => {
  let iscaBatida = 0;
  const interno = await subirServidor((q, s) => { iscaBatida++; s.end('SEGREDO INTERNO'); });
  const publico = await subirServidor((q, s) => {
    s.writeHead(302, { Location: `http://127.0.0.1:${interno.porta}/roubar` }); s.end();
  });
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'fachada.teste': '127.0.0.1' } });
    await assert.rejects(
      rede.fetchSeguro(`http://fachada.teste:${publico.porta}/`),
      e => e instanceof ErroSSRF && /127\.0\.0\.1/.test(e.message),
    );
    assert.equal(iscaBatida, 0, 'a isca interna NÃO pode ter sido alcançada');
  } finally { interno.fechar(); publico.fechar(); }
});

test('fetchSeguro RECUSA o 302 para um NOME que resolve para IP interno', async () => {
  let iscaBatida = 0;
  const interno = await subirServidor((q, s) => { iscaBatida++; s.end('SEGREDO'); });
  const publico = await subirServidor((q, s) => {
    s.writeHead(302, { Location: `http://interno.teste:${interno.porta}/` }); s.end();
  });
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'fachada.teste': '127.0.0.1', 'interno.teste': '127.0.0.1' },
      // "interno.teste" é interno de verdade: o resolver o entrega como loopback.
      resolver: (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) });
    // fachada via hostsDeTeste (tratada como pública), mas o salto vai para interno.teste,
    // que passa pelo lookupSeguro e é classificado como interno.
    const rede2 = criarRedeSegura({
      hostsDeTeste: { 'fachada.teste': '127.0.0.1' },
      resolver: (host, opts, cb) => host === 'interno.teste'
        ? cb(null, [{ address: '127.0.0.1', family: 4 }])
        : cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })),
    });
    await assert.rejects(rede2.fetchSeguro(`http://fachada.teste:${publico.porta}/`), ErroSSRF);
    assert.equal(iscaBatida, 0);
  } finally { interno.fechar(); publico.fechar(); }
});

test('fetchSeguro SEGUE o 302 quando o destino também é público', async () => {
  const destino = await subirServidor((q, s) => s.end('cheguei no destino'));
  const origem = await subirServidor((q, s) => {
    s.writeHead(302, { Location: `http://destino.teste:${destino.porta}/ok` }); s.end();
  });
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'origem.teste': '127.0.0.1', 'destino.teste': '127.0.0.1' } });
    const r = await rede.fetchSeguro(`http://origem.teste:${origem.porta}/`);
    assert.equal(r.status, 200);
    assert.equal(r.redirected, true);
    assert.equal(await r.text(), 'cheguei no destino');
  } finally { destino.fechar(); origem.fechar(); }
});

test('fetchSeguro recusa IP literal interno de imediato (sem conectar)', async () => {
  const rede = criarRedeSegura();
  await assert.rejects(rede.fetchSeguro('http://[::ffff:127.0.0.1]:80/'), ErroSSRF);
  await assert.rejects(rede.fetchSeguro('http://169.254.169.254/latest/meta-data/'), ErroSSRF);
});

test('fetchSeguro só aceita GET e HEAD', async () => {
  const rede = criarRedeSegura();
  await assert.rejects(rede.fetchSeguro('https://exemplo.com/', { method: 'POST' }), TypeError);
});

test('lookupSeguro (dentro da conexão) barra um nome cujo DNS devolve IP interno', async () => {
  let iscaBatida = 0;
  const interno = await subirServidor((q, s) => { iscaBatida++; s.end('x'); });
  try {
    // o nome "parece público", mas o DNS responde loopback (rebinding)
    const rede = criarRedeSegura({ resolver: (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) });
    await assert.rejects(rede.fetchSeguro(`http://rebind.teste:${interno.porta}/`), ErroSSRF);
    assert.equal(iscaBatida, 0);
  } finally { interno.fechar(); }
});

test('lookupSeguro recusa se UM dos endereços do nome for interno (mistura suspeita)', async () => {
  const rede = criarRedeSegura({ resolver: (host, opts, cb) =>
    cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]) });
  await assert.rejects(rede.fetchSeguro('http://misto.teste/'), ErroSSRF);
});
