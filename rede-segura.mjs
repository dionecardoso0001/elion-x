/**
 * ELION-X · REDE SEGURA — a trava ÚNICA contra SSRF da plataforma
 *
 * Toda requisição que o SERVIDOR faz para um endereço vindo de fora (pedido em
 * voz, texto de página, URL do visor, catálogo de APIs) passa por aqui. Antes
 * havia uma cópia da regra em cada módulo, e as cópias tinham três buracos:
 *
 *  1. IPv6 que embute IPv4. "::ffff:127.0.0.1" (ou "::ffff:7f00:1", a mesma
 *     coisa em hexadecimal) é o 127.0.0.1 visto pela pilha IPv6: o socket
 *     chega ao loopback. A regra antiga só olhava IPv4 puro e alguns prefixos.
 *  2. Conferir um IP e conectar em outro (TOCTOU / DNS rebinding). Resolver o
 *     nome para conferir e depois deixar o fetch resolver DE NOVO permite a um
 *     DNS malicioso responder "público" na checagem e "interno" na conexão.
 *  3. Redirecionamento seguido às cegas: um 302 para http://127.0.0.1:3001/
 *     levava a requisição para dentro depois de a checagem já ter passado.
 *
 * Como esta trava fecha cada um:
 *  1. classificarIP() normaliza IPv4 mapeado, NAT64 e 6to4 para o IPv4
 *     embutido, e só aceita IPv6 de unicast global (2000::/3) fora das faixas
 *     especiais. Na dúvida, recusa: texto que não é IP é tratado como interno.
 *  2. A conferência acontece DENTRO da conexão: o socket resolve o nome pelo
 *     lookupSeguro(), então o endereço conferido é exatamente o conectado.
 *     IP literal não passa por lookup no Node, por isso é conferido antes.
 *  3. fetchSeguro() segue redirecionamento À MÃO, e cada salto passa pelas
 *     mesmas duas conferências.
 *
 * Sem dependência externa (http, https e dns do próprio Node): o ELION
 * continua subindo com "node server.js", sem npm install obrigatório.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import zlib from 'node:zlib';
import { Readable, pipeline } from 'node:stream';

export class ErroSSRF extends Error {
  constructor(mensagem, { host, ip, motivo, cause } = {}) {
    super(mensagem, cause ? { cause } : undefined);
    this.name = 'ErroSSRF';
    this.code = 'ERR_SSRF_BLOQUEADO';
    if (host) this.host = host;
    if (ip) this.ip = ip;
    if (motivo) this.motivo = motivo;
  }
}

/* ── CLASSIFICAÇÃO DE ENDEREÇO ──────────────────────────────────────────────
   Faixas IPv4 que não são internet pública (registro de endereços de
   propósito especial da IANA, mais multicast e reservado). */
const v4ParaNumero = ip => ip.split('.').reduce((n, octeto) => n * 256 + Number(octeto), 0);

const FAIXAS_V4 = [
  ['0.0.0.0',       8, '"esta rede": 0.0.0.0 alcança o próprio computador'],
  ['10.0.0.0',      8, 'rede privada'],
  ['100.64.0.0',   10, 'CGNAT, rede interna de operadora'],
  ['127.0.0.0',     8, 'loopback, o próprio computador'],
  ['169.254.0.0',  16, 'link-local, inclui o endpoint de metadados de nuvem'],
  ['172.16.0.0',   12, 'rede privada'],
  ['192.0.0.0',    24, 'faixa de protocolos da IETF'],
  ['192.0.2.0',    24, 'faixa de documentação'],
  ['192.168.0.0',  16, 'rede privada'],
  ['198.18.0.0',   15, 'faixa de testes de desempenho'],
  ['198.51.100.0', 24, 'faixa de documentação'],
  ['203.0.113.0',  24, 'faixa de documentação'],
  ['224.0.0.0',     4, 'multicast'],
  ['240.0.0.0',     4, 'reservado e broadcast'],
].map(([base, bits, motivo]) => ({ inicio: v4ParaNumero(base), tamanho: 2 ** (32 - bits), motivo, cidr: `${base}/${bits}` }));

function classificarV4(ip) {
  const n = v4ParaNumero(ip);
  const f = FAIXAS_V4.find(f => n >= f.inicio && n < f.inicio + f.tamanho);
  return f ? { bloqueado: true, motivo: `${f.motivo} (${f.cidr})` } : { bloqueado: false, motivo: 'IPv4 público' };
}

/* IPv6 validado (net.isIPv6) → 8 grupos de 16 bits. Aceita o IPv4 escrito no
   fim ("::ffff:127.0.0.1") convertendo-o para os dois últimos grupos. */
function gruposV6(ip) {
  let s = ip;
  const ultimo = s.lastIndexOf(':');
  const cauda = s.slice(ultimo + 1);
  if (cauda.includes('.')) {
    const [a, b, c, d] = cauda.split('.').map(Number);
    s = s.slice(0, ultimo + 1) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [esquerda, direita] = s.split('::');
  const e = esquerda ? esquerda.split(':') : [];
  const d = direita === undefined || direita === '' ? [] : direita.split(':');
  const meio = direita === undefined ? [] : Array(8 - e.length - d.length).fill('0');
  return [...e, ...meio, ...d].map(g => parseInt(g, 16));
}

const v4De = (alto, baixo) => `${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`;

function classificarV6(ip) {
  const g = gruposV6(ip);
  const zerado = (de, ate) => g.slice(de, ate).every(x => x === 0);
  const bloq = motivo => ({ bloqueado: true, motivo });
  // IPv6 que carrega um IPv4 dentro: vale a regra do IPv4 embutido
  const embutido = (como, v4) => {
    const c = classificarV4(v4);
    return { bloqueado: c.bloqueado, motivo: `${como} de ${v4}: ${c.motivo}`, ipv4: v4 };
  };

  if (zerado(0, 5) && g[5] === 0xffff) return embutido('IPv4 mapeado em IPv6', v4De(g[6], g[7]));   // ::ffff:0:0/96
  if (zerado(0, 6)) {                                                                              // ::/96
    if (g[6] === 0 && g[7] === 0) return bloq('endereço não especificado (::)');
    if (g[6] === 0 && g[7] === 1) return bloq('loopback IPv6 (::1)');
    return bloq('IPv4 compatível, formato obsoleto (::/96)');
  }
  if (zerado(0, 4) && g[4] === 0xffff && g[5] === 0) return bloq('IPv4 traduzido (::ffff:0:0:0/96)');
  if (g[0] === 0x64 && g[1] === 0xff9b && zerado(2, 6)) return embutido('NAT64', v4De(g[6], g[7]));  // 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return bloq('NAT64 de uso local (64:ff9b:1::/48)');
  if (g[0] === 0x100 && zerado(1, 4)) return bloq('faixa de descarte (100::/64)');
  if ((g[0] & 0xfe00) === 0xfc00) return bloq('rede privada IPv6 (fc00::/7)');
  if ((g[0] & 0xffc0) === 0xfe80) return bloq('link-local IPv6 (fe80::/10)');
  if ((g[0] & 0xffc0) === 0xfec0) return bloq('site-local IPv6, obsoleto (fec0::/10)');
  if ((g[0] & 0xff00) === 0xff00) return bloq('multicast IPv6 (ff00::/8)');
  if (g[0] === 0x2001 && g[1] === 0x0db8) return bloq('faixa de documentação (2001:db8::/32)');
  if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return bloq('faixa de documentação (3fff::/20)');
  if (g[0] === 0x2001 && (g[1] & 0xfe00) === 0) return bloq('faixa de protocolos da IETF, inclui Teredo (2001::/23)');
  if (g[0] === 0x2002) return embutido('6to4', v4De(g[1], g[2]));                                  // 2002::/16
  if ((g[0] & 0xe000) !== 0x2000) return bloq('fora do unicast global IPv6 (2000::/3)');
  return { bloqueado: false, motivo: 'IPv6 público' };
}

/**
 * Diz se um IP é interno, reservado ou não roteável na internet.
 * @param {string} entrada  IPv4 ou IPv6 (aceita colchetes e zona: "[fe80::1%eth0]")
 * @returns {{ip: string, bloqueado: boolean, motivo: string, ipv4?: string}}
 */
export function classificarIP(entrada) {
  let ip = String(entrada ?? '').trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  if (net.isIPv4(ip)) return { ip, ...classificarV4(ip) };
  // a zona (%eth0) escolhe a interface, não muda a faixa do endereço
  if (net.isIPv6(ip)) return { ip, ...classificarV6(ip.split('%')[0].toLowerCase()) };
  return { ip, bloqueado: true, motivo: 'não é um endereço IP válido' };
}

export const ipBloqueado = ip => classificarIP(ip).bloqueado;

const semColchetes = host => String(host).replace(/^\[(.*)\]$/, '$1');

function erroDeEndereco(host, ip, motivo) {
  const quem = host === ip ? ip : `"${host}" aponta para ${ip}`;
  return new ErroSSRF(`${quem}: ${motivo}. Bloqueado por segurança.`, { host, ip, motivo });
}

/**
 * Confere o que dá para conferir numa URL sem tocar na rede: só http/https,
 * sem usuário:senha embutidos, e IP literal tem de ser público.
 * Nome de host é conferido na conexão (lookupSeguro), não aqui.
 * @returns {URL}
 */
export function conferirUrl(alvo) {
  let url;
  try { url = new URL(alvo instanceof URL ? alvo.href : String(alvo)); }
  catch { throw new TypeError(`URL inválida: ${String(alvo).slice(0, 200)}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new ErroSSRF(`só http/https são permitidos (recebi "${url.protocol}")`);
  if (url.username || url.password)
    throw new ErroSSRF('URL com usuário e senha embutidos não é aceita');
  const host = semColchetes(url.hostname);
  if (net.isIP(host)) {
    const c = classificarIP(host);
    if (c.bloqueado) throw erroDeEndereco(host, host, c.motivo);
  }
  return url;
}

/**
 * lookup que responde sempre os mesmos endereços já verificados, sem nova
 * consulta de DNS. Serve para "fixar" uma conexão (tls.connect, net.connect)
 * no IP que passou pela trava.
 */
export function lookupFixo(enderecos) {
  const lista = enderecos.map(e => typeof e === 'string' ? { address: e, family: net.isIP(e) } : e);
  const ruim = lista.find(e => classificarIP(e.address).bloqueado);
  if (ruim) throw erroDeEndereco(ruim.address, ruim.address, classificarIP(ruim.address).motivo);
  return (hostname, opcoes, callback) => {
    if (typeof opcoes === 'function') { callback = opcoes; opcoes = {}; }
    const familia = typeof opcoes === 'number' ? opcoes : opcoes?.family;
    const filtrada = familia === 4 || familia === 6 ? lista.filter(e => e.family === familia) : lista;
    if (!filtrada.length)
      return process.nextTick(callback, Object.assign(new Error(`nenhum endereço verificado para "${hostname}"`), { code: 'ENOTFOUND' }));
    if (opcoes?.all) process.nextTick(callback, null, filtrada);
    else process.nextTick(callback, null, filtrada[0].address, filtrada[0].family);
  };
}

/* ── CLIENTE HTTP COM A TRAVA EMBUTIDA ─────────────────────────────────────── */
const REDIRECIONA = new Set([301, 302, 303, 307, 308]);
const SEM_CORPO = new Set([204, 205, 304]);
const CREDENCIAIS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/* Mesmos cabeçalhos padrão que o fetch do Node manda: o servidor do outro
   lado responde como respondia antes da troca de cliente. */
function montarCabecalhos(origem) {
  const h = new Headers(origem || {});
  for (const k of ['host', 'connection', 'content-length', 'transfer-encoding']) h.delete(k);
  if (!h.has('accept')) h.set('accept', '*/*');
  if (!h.has('accept-language')) h.set('accept-language', '*');
  if (!h.has('accept-encoding')) h.set('accept-encoding', 'gzip, deflate, br');
  if (!h.has('sec-fetch-mode')) h.set('sec-fetch-mode', 'cors');
  if (!h.has('user-agent')) h.set('user-agent', 'node');
  return Object.fromEntries(h);
}

/* Descompressão com a mesma tolerância do fetch: corpo truncado entrega o que
   chegou em vez de estourar. Codificação desconhecida passa como veio. */
function decodificadores(codificacao) {
  if (!codificacao) return [];
  const tolerante = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  const etapas = [];
  for (const c of codificacao.toLowerCase().split(',').map(s => s.trim()).filter(Boolean).reverse()) {
    if (c === 'gzip' || c === 'x-gzip') etapas.push(zlib.createGunzip(tolerante));
    else if (c === 'deflate') etapas.push(zlib.createUnzip(tolerante));
    else if (c === 'br') etapas.push(zlib.createBrotliDecompress({
      flush: zlib.constants.BROTLI_OPERATION_FLUSH, finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH }));
    else if (c !== 'identity') return [];
  }
  return etapas;
}

function paraResponse(res, url, metodo, sinal, redirecionado) {
  const status = res.statusCode;
  if (!(status >= 200 && status <= 599)) throw new TypeError(`status HTTP fora do padrão: ${status}`);
  const headers = new Headers();
  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    try { headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch { /* cabeçalho malformado: descartado */ }
  }
  let corpo = null;
  if (metodo !== 'HEAD' && !SEM_CORPO.has(status)) {
    const etapas = decodificadores(headers.get('content-encoding'));
    const fluxo = etapas.length ? pipeline(res, ...etapas, () => {}) : res;
    const abortar = () => fluxo.destroy(sinal.reason);
    sinal.addEventListener('abort', abortar, { once: true });
    fluxo.once('close', () => sinal.removeEventListener('abort', abortar));
    corpo = Readable.toWeb(fluxo);
  } else res.resume();
  const statusText = /^[\t\x20-\x7e\x80-\xff]*$/.test(res.statusMessage || '') ? res.statusMessage || '' : '';
  const r = new Response(corpo, { status, statusText, headers });
  Object.defineProperty(r, 'url', { value: url.href, enumerable: true });
  Object.defineProperty(r, 'redirected', { value: redirecionado, enumerable: true });
  return r;
}

/**
 * Fábrica da trava. A plataforma usa a instância padrão, exportada abaixo.
 * @param {object} [o]
 * @param {Function} [o.resolver]  dns.lookup (padrão). Os testes trocam para
 *   simular DNS, inclusive rebinding. NÃO afrouxa nada: todo endereço que ele
 *   devolver passa pela mesma classificação.
 * @param {Object<string,string>} [o.hostsDeTeste]  SOMENTE para testes: nome →
 *   IP aceito sem classificação, para simular "um site público" servido por um
 *   servidor local. A instância da plataforma não tem nenhum.
 */
export function criarRedeSegura({ resolver = dns.lookup, hostsDeTeste = null } = {}) {

  /** lookup no formato do dns.lookup, para net/tls/http: recusa se QUALQUER
      endereço do nome for interno (nome com IP público e privado é suspeito). */
  function lookupSeguro(hostname, opcoes, callback) {
    if (typeof opcoes === 'function') { callback = opcoes; opcoes = {}; }
    else if (typeof opcoes === 'number') opcoes = { family: opcoes };
    opcoes = opcoes || {};
    const fim = (...args) => process.nextTick(callback, ...args);
    const responder = lista => opcoes.all ? fim(null, lista) : fim(null, lista[0].address, lista[0].family);

    if (hostsDeTeste && Object.hasOwn(hostsDeTeste, hostname)) {
      const address = hostsDeTeste[hostname];
      return responder([{ address, family: net.isIP(address) }]);
    }
    try {
      resolver(hostname, { ...opcoes, all: true }, (erro, enderecos) => {
        if (erro) return fim(erro);
        const lista = Array.isArray(enderecos) ? enderecos : [];
        if (!lista.length)
          return fim(Object.assign(new Error(`"${hostname}" não tem endereço IP`), { code: 'ENOTFOUND' }));
        for (const { address } of lista) {
          const c = classificarIP(address);
          if (c.bloqueado) return fim(erroDeEndereco(hostname, address, c.motivo));
        }
        responder(lista);
      });
    } catch (e) { fim(e); }
  }

  /** Resolve o host e devolve os endereços, todos públicos; ou lança ErroSSRF. */
  function resolverPublico(host) {
    const h = semColchetes(String(host || '').trim());
    if (!h) return Promise.reject(new ErroSSRF('endereço vazio'));
    if (net.isIP(h)) {
      const c = classificarIP(h);
      return c.bloqueado ? Promise.reject(erroDeEndereco(h, h, c.motivo))
                         : Promise.resolve([{ address: h, family: net.isIP(h) }]);
    }
    return new Promise((ok, falha) => lookupSeguro(h, { all: true }, (e, lista) => e ? falha(e) : ok(lista)));
  }

  function requisitar(url, metodo, cabecalhos, sinal, redirecionado) {
    return new Promise((ok, falha) => {
      const seguro = url.protocol === 'https:';
      const req = (seguro ? https : http).request({
        protocol: url.protocol,
        hostname: semColchetes(url.hostname),
        port: url.port || (seguro ? 443 : 80),
        path: url.pathname + url.search,
        method: metodo,
        headers: cabecalhos,
        lookup: lookupSeguro,   // ⚠ a conferência do IP acontece na própria conexão
        agent: false,           // conexão própria: nunca reaproveita socket aberto por outro código
        signal: sinal,
      }, res => {
        try { ok(paraResponse(res, url, metodo, sinal, redirecionado)); }
        catch (e) { res.destroy(); falha(e); }
      });
      req.on('error', falha);
      req.end();
    });
  }

  /**
   * fetch com a trava: GET/HEAD, só http/https, IP conferido em cada conexão
   * e redirecionamento seguido à mão, com cada salto conferido de novo.
   * Devolve uma Response como a do fetch (status, headers, text(), url…).
   * @param {string|URL} alvo
   * @param {{method?: string, headers?: object, redirect?: 'follow'|'manual',
   *          signal?: AbortSignal, maxRedirecionamentos?: number}} [opcoes]
   */
  async function fetchSeguro(alvo, opcoes = {}) {
    const { method = 'GET', headers, redirect = 'follow', signal, maxRedirecionamentos = 20 } = opcoes;
    const metodo = String(method).toUpperCase();
    if (metodo !== 'GET' && metodo !== 'HEAD') throw new TypeError(`fetchSeguro só faz GET e HEAD (recebi ${metodo})`);
    if (redirect !== 'follow' && redirect !== 'manual') throw new TypeError(`redirect "${redirect}" não é suportado`);
    const sinal = signal || AbortSignal.timeout(30000);

    let url = conferirUrl(alvo);
    let cabecalhos = montarCabecalhos(headers);
    for (let saltos = 0; ; saltos++) {
      sinal.throwIfAborted();
      const r = await requisitar(url, metodo, cabecalhos, sinal, saltos > 0);
      const destino = r.headers.get('location');
      if (redirect === 'manual' || !REDIRECIONA.has(r.status) || destino === null) return r;

      await r.body?.cancel().catch(() => {});
      if (saltos >= maxRedirecionamentos) throw new TypeError(`redirecionamentos demais (mais de ${maxRedirecionamentos})`);
      let proxima;
      try { proxima = new URL(destino, url); }
      catch { throw new TypeError(`redirecionamento para URL inválida: ${destino.slice(0, 200)}`); }
      // credencial não acompanha a requisição para outro dono (regra do fetch)
      if (proxima.origin !== url.origin)
        cabecalhos = Object.fromEntries(Object.entries(cabecalhos).filter(([k]) => !CREDENCIAIS.has(k)));
      url = conferirUrl(proxima);   // ⚠ cada salto passa pela trava de novo
    }
  }

  return { lookupSeguro, resolverPublico, fetchSeguro, conferirUrl, lookupFixo };
}

const PADRAO = criarRedeSegura();
export const { lookupSeguro, resolverPublico, fetchSeguro } = PADRAO;
export default PADRAO;
