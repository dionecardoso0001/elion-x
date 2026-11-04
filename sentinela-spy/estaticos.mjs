/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — o que o servidor pode entregar, e como

   LISTA DE PERMISSÃO, não de bloqueio: só sai o que a interface usa.
   Lista de bloqueio perde para a criatividade do sistema de arquivos —
   no Windows o NTFS abre .env como ENV~1 e uma pasta como
   pasta::$INDEX_ALLOCATION. Caminho com ":" ou "~" ou segmento oculto é
   recusado de saída, e o servidor confere o caminho REAL no disco.
   ═══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

/** Arquivos da raiz e pastas que a interface carrega. Também é o que vai para dist/. */
export const PUBLICOS_RAIZ = ['index.html', 'manifest.webmanifest', 'sw.js', 'robots.txt', 'plataforma.json'];
export const PASTAS_PUBLICAS = ['css', 'js', 'fontes', 'icones', 'vendor', 'modelos'];

/**
 * CSP da interface. Fontes de script: a própria origem e o CDN do runtime
 * (contingência na MESMA versão). 'wasm-unsafe-eval' é o mínimo que o
 * WebAssembly do MediaPipe exige — não libera eval de JavaScript.
 * connect-src: a própria origem, a API da Anthropic (modo chave própria) e
 * as origens de contingência dos modelos e do runtime.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "connect-src 'self' https://api.anthropic.com https://storage.googleapis.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const CABECALHOS_SEGURANCA = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
});

const segmentos = rel => rel.split(/[\\/]/).filter(Boolean);

/** Caminho relativo que nunca pode ser servido, venha de onde vier. */
export function caminhoProibido(rel) {
  return /[:~\0]/.test(rel) || segmentos(rel).some(s => s.startsWith('.'));
}

/** 'publico' | 'negado' | 'desconhecido' para um caminho JÁ decodificado. */
export function classificarCaminho(decodificado) {
  const rel = String(decodificado || '').replace(/^[\\/]+/, '');
  if (rel === '') return 'publico';
  if (caminhoProibido(rel)) return 'negado';
  if (PUBLICOS_RAIZ.includes(rel)) return 'publico';
  const [primeiro, ...resto] = segmentos(rel);
  if (PASTAS_PUBLICAS.includes(primeiro) && resto.length) return 'publico';
  return 'desconhecido';
}

/* ═══════════════════ ENTREGA: compressão, ETag e 304 ═══════════════════
   O WASM do MediaPipe tem 13,5 MB; em brotli (q5) viaja como 3,3 MB.
   Modelos .tflite/.task são pesos float16 e encolhem ~12%: não entram.
   Corpo comprimido calculado uma vez por versão do arquivo, no pool do
   libuv, em cache LRU com teto de memória. */
export const COMPRIMIVEIS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.map', '.wasm']);
const MIN_COMPRIMIR = 1024;
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Accept-Encoding com pesos q (RFC 9110 §12.5.3): maior q vence, empate favorece brotli. */
export function escolherCodificacao(aceito = '') {
  const q = new Map();
  for (const parte of String(aceito || '').toLowerCase().split(',')) {
    const [nome, ...params] = parte.split(';').map(s => s.trim());
    if (!nome) continue;
    let peso = 1;
    for (const p of params) { const m = /^q=([0-9.]+)$/.exec(p); if (m) peso = Number(m[1]); }
    q.set(nome, Number.isFinite(peso) ? peso : 0);
  }
  const peso = n => (q.has(n) ? q.get(n) : q.has('*') ? q.get('*') : 0);
  const candidatos = [['br', peso('br')], ['gzip', peso('gzip')]].filter(([, w]) => w > 0);
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0][0];
}

export function etagDe(st, cod = null) {
  const sufixo = cod === 'br' ? '-br' : cod === 'gzip' ? '-gz' : '';
  return `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${sufixo}"`;
}

export function casaETag(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  const opaca = t => t.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some(t => opaca(t) === opaca(etag));
}

export function criarEntregador({ maxBytes = 64 * 2 ** 20 } = {}) {
  const cache = new Map();
  let total = 0;
  const despejar = () => {
    for (const [chave, item] of cache) {
      if (total <= maxBytes) break;
      if (item.bytes == null) continue;
      cache.delete(chave); total -= item.bytes;
    }
  };
  function comprimido(arquivo, st, cod) {
    const chave = `${arquivo}|${st.size}|${st.mtimeMs}|${cod}`;
    const achado = cache.get(chave);
    if (achado) { cache.delete(chave); cache.set(chave, achado); return achado.promessa; }
    const item = { bytes: null, promessa: null };
    item.promessa = fs.promises.readFile(arquivo).then(b => (cod === 'br'
      ? brotli(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } })
      : gzip(b, { level: 6 })));
    cache.set(chave, item);
    item.promessa.then(
      buf => { if (cache.get(chave) === item) { item.bytes = buf.length; total += buf.length; despejar(); } },
      () => { if (cache.get(chave) === item) cache.delete(chave); },
    );
    return item.promessa;
  }
  async function servir(req, res, arquivo, { tipo, cacheControl, cabecalhos = {}, st = null }) {
    st ??= await fs.promises.stat(arquivo);
    const ext = path.extname(arquivo).toLowerCase();
    const variavel = COMPRIMIVEIS.has(ext) && st.size >= MIN_COMPRIMIR;
    const cod = variavel ? escolherCodificacao(req.headers['accept-encoding']) : null;
    const etag = etagDe(st, cod);
    const meta = { 'Cache-Control': cacheControl, ETag: etag, ...(variavel ? { Vary: 'Accept-Encoding' } : {}), ...cabecalhos };
    if (casaETag(req.headers['if-none-match'], etag)) { res.writeHead(304, meta); return res.end(); }
    const cabec = { 'Content-Type': tipo, 'Last-Modified': new Date(st.mtimeMs).toUTCString(), ...meta };
    if (cod) {
      const corpo = await comprimido(arquivo, st, cod);
      res.writeHead(200, { ...cabec, 'Content-Encoding': cod, 'Content-Length': corpo.length });
      return res.end(req.method === 'HEAD' ? undefined : corpo);
    }
    res.writeHead(200, { ...cabec, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(arquivo).on('error', () => res.destroy()).pipe(res);
  }
  return { servir, comprimido, get bytesEmCache() { return total; }, get entradas() { return cache.size; } };
}
