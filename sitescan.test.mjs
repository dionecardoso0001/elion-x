/**
 * Testes da auditoria de sites (sitescan.mjs) com foco na trava de SSRF.
 *   node --test sitescan.test.mjs
 *
 * A rede é injetada: hostsDeTeste trata um NOME como público apontando-o para
 * um servidor local, então a auditoria roda inteira sem sair para a internet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { auditarSite } from './sitescan.mjs';
import { criarRedeSegura, ErroSSRF } from './rede-segura.mjs';

async function subirServidor(handler) {
  const srv = http.createServer(handler);
  await once(srv.listen(0, '127.0.0.1'), 'listening');
  return { porta: srv.address().port, fechar: () => srv.close() };
}

/* Um "site público" de mentira: responde na raiz com alguns cabeçalhos de
   segurança e 404 nos caminhos sensíveis — o que um site decente faz. */
function siteDecente(q, s) {
  if (q.url === '/') {
    s.writeHead(200, {
      'Content-Type': 'text/html',
      'Strict-Transport-Security': 'max-age=63072000',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Server': 'nginx',
    });
    return s.end('<!doctype html><html><body>Olá, mundo público.</body></html>');
  }
  s.writeHead(404); s.end('não existe');
}

test('audita um site público (via nome) de ponta a ponta e devolve a nota', async () => {
  const { porta, fechar } = await subirServidor(siteDecente);
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'cliente.teste': '127.0.0.1' } });
    const a = await auditarSite(`http://cliente.teste:${porta}/`, { rede });
    assert.equal(a.status, 200);
    assert.match(a.nota, /^[A-F]$/, 'deve sair uma nota A–F');
    assert.equal(a.host, 'cliente.teste');
    assert.ok(Array.isArray(a.cabecalhos.presentes));
    assert.ok(a.cabecalhos.presentes.some(c => c.nome === 'HSTS'), 'deveria ter visto o HSTS que o site enviou');
    assert.equal(a.caminhosExpostos.length, 0, 'nenhum caminho sensível foi exposto');
    assert.ok(Array.isArray(a.recomendacoes));
  } finally { fechar(); }
});

test('acha um caminho sensível exposto num site público de teste', async () => {
  const { porta, fechar } = await subirServidor((q, s) => {
    if (q.url === '/.env') { s.writeHead(200, { 'Content-Type': 'text/plain' }); return s.end('DB_PASSWORD=supersecreta\nAWS_SECRET=xyz'); }
    if (q.url === '/') { s.writeHead(200, { 'Content-Type': 'text/html' }); return s.end('<html><body>ok</body></html>'); }
    s.writeHead(404); s.end();
  });
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'frouxo.teste': '127.0.0.1' } });
    const a = await auditarSite(`http://frouxo.teste:${porta}/`, { rede });
    assert.ok(a.caminhosExpostos.some(c => c.caminho === '/.env'), 'o /.env exposto deveria ter sido detectado');
  } finally { fechar(); }
});

/* ── as brechas do ticket ─────────────────────────────────────────────────── */

test('RECUSA quando o 302 do site redireciona para 127.0.0.1', async () => {
  let iscaBatida = 0;
  const interno = await subirServidor((q, s) => { iscaBatida++; s.end('SEGREDO INTERNO'); });
  const alvo = await subirServidor((q, s) => {
    if (q.url === '/') { s.writeHead(302, { Location: `http://127.0.0.1:${interno.porta}/metadata` }); return s.end(); }
    s.writeHead(404); s.end();
  });
  try {
    const rede = criarRedeSegura({ hostsDeTeste: { 'alvo.teste': '127.0.0.1' } });
    await assert.rejects(
      auditarSite(`http://alvo.teste:${alvo.porta}/`, { rede }),
      e => e instanceof ErroSSRF && /127\.0\.0\.1/.test(e.message),
    );
    assert.equal(iscaBatida, 0, 'a auditoria NÃO pode ter alcançado o servidor interno');
  } finally { interno.fechar(); alvo.fechar(); }
});

test('RECUSA DNS rebinding: público na checagem, interno na conexão', async () => {
  let iscaBatida = 0;
  const interno = await subirServidor((q, s) => { iscaBatida++; s.end('SEGREDO'); });
  try {
    let chamada = 0;
    const rede = criarRedeSegura({
      resolver: (host, opts, cb) => {
        chamada++;
        // 1ª resolução (a pré-checagem) diz "público"; a 2ª (a conexão real) vira loopback
        const addr = chamada === 1 ? '93.184.216.34' : '127.0.0.1';
        cb(null, [{ address: addr, family: 4 }]);
      },
    });
    await assert.rejects(auditarSite(`http://rebind.teste:${interno.porta}/`, { rede }), ErroSSRF);
    assert.equal(iscaBatida, 0, 'o rebinding não pode ter alcançado o servidor interno');
  } finally { interno.fechar(); }
});

// literais internos — incluindo os IPv6 que embutem IPv4 que a regra antiga deixava passar
for (const alvo of [
  'http://[::ffff:127.0.0.1]/',   // IPv4 mapeado
  'http://[::ffff:7f00:1]/',      // o mesmo, em hexadecimal
  'http://[64:ff9b::7f00:1]/',    // NAT64 embutindo 127.0.0.1
  'http://[::1]/',                // loopback IPv6
  'https://0.0.0.0/',             // "esta rede"
  'http://[::]/',                 // não especificado
  'https://127.0.0.1/',           // loopback IPv4
  'https://169.254.169.254/latest/meta-data/', // metadados de nuvem
  'http://[fd00::1]/',            // ULA IPv6
]) {
  test(`RECUSA auditoria de endereço interno literal: ${alvo}`, async () => {
    await assert.rejects(auditarSite(alvo), e => e instanceof ErroSSRF,
      `${alvo} deveria ser recusado como ErroSSRF`);
  });
}

test('um esquema não-web (ftp://) nunca é auditado como alvo', async () => {
  await assert.rejects(auditarSite('ftp://exemplo.com/'));
});

/* Teste AO VIVO contra um site público real (TLS + IP público + pipeline
   inteiro). Sai para a internet, então só roda com ELION_TESTE_REDE=1. */
test('audita um site público REAL (opcional)', { skip: !process.env.ELION_TESTE_REDE }, async () => {
  const a = await auditarSite('https://example.com');
  assert.match(a.nota, /^[A-F]$/);
  assert.equal(a.https, true);
  assert.ok(a.tls && (a.tls.protocolo || a.tls.erro), 'deveria ter inspecionado o TLS');
  assert.ok(a.status >= 200 && a.status < 500);
});
