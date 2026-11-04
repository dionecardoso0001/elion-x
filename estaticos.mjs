/* ═══════════════════════════════════════════════════════════════════════
   ELION-X — o que o servidor de estáticos pode entregar

   LISTA DE PERMISSÃO, não de bloqueio. A primeira correção (bloquear
   segmento oculto, data/, node_modules/, bin/) fechou o GET /.env no
   Linux, mas a revisão de segurança mostrou que no Windows — onde o
   ELION-X roda de fato — o NTFS abre o mesmo arquivo por nomes que um
   filtro de texto não reconhece:
     · nome curto 8.3:      /ENV~1            → .env
                            /GIT~1/config     → .git/config
     · fluxo de diretório:  /data::$INDEX_ALLOCATION/google-token.json
   Lista de bloqueio sempre perde para a criatividade do sistema de
   arquivos. Então: só sai daqui o que a interface usa — oito arquivos
   da raiz e a árvore assets/ — e qualquer caminho com ":" ou "~" (que
   nenhum arquivo legítimo da plataforma tem) é recusado de saída.
   O servidor ainda confere o caminho REAL resolvido no disco
   (realpath), que pega link simbólico e qualquer apelido restante.
   ═══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

/**
 * Cabeçalhos de segurança de tudo que a INTERFACE serve.
 * · frame-ancestors/X-Frame-Options: só a própria plataforma enquadra suas
 *   páginas (o visor da central). Sem isto, qualquer site aberto pelo
 *   operador podia enquadrar http://localhost:3001 — endereço previsível — e
 *   induzir cliques em botões que enviam WhatsApp ou leem e-mail (clickjacking).
 * · Permissions-Policy: câmera, microfone e GPS só para a própria origem,
 *   nunca para iframe de terceiro.
 * · X-Robots-Tag: central pessoal com câmera, e-mail e WhatsApp não tem nada a
 *   ganhar em buscador — e o túnel do acesso mobile a põe na internet. Junto
 *   com o robots.txt (Disallow: /), é decisão deliberada contra a nota de "SEO"
 *   do Lighthouse, que mede o oposto do que esta plataforma quer.
 */
export const CABECALHOS_SEGURANCA = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)',
  'X-Robots-Tag': 'noindex, nofollow',
});

/**
 * Conteúdo de TERCEIRO servido na nossa origem pelo proxy do visor.
 * A remoção de <script> por regex não basta: manipulador de evento
 * (<img src=x onerror=…>) passa direto e <scr<script></script>ipt> se
 * remonta depois da remoção. Servido na MESMA origem, esse script alcançaria
 * /api/memory, /api/email e o envio de WhatsApp. O sandbox sem allow-scripts
 * impede qualquer script; sem allow-same-origin o documento ganha origem
 * OPACA — mesmo que algo rodasse, não seria "da casa".
 */
export const CABECALHOS_TERCEIRO = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox allow-popups allow-popups-to-escape-sandbox allow-forms; script-src 'none'; object-src 'none'",
});

/** Arquivos da raiz que a interface carrega (levantado de todos os HTML/JS do cliente). */
export const PUBLICOS_RAIZ = new Set([
  'index.html', 'sentinela.html', 'cyber.html', 'brain.html', 'whatsapp.html',
  'manifest.webmanifest', 'sentinela.webmanifest', 'sw.js', 'robots.txt',
]);

const NEGADOS = /^(data|node_modules|bin)([\\/]|$)/i;

/** Segmentos do caminho, separando por "/" e por "\" (o Windows aceita os dois). */
const segmentos = rel => rel.split(/[\\/]/).filter(Boolean);

/** Caminho relativo que nunca pode ser servido, venha de onde vier. */
export function caminhoProibido(rel) {
  return /[:~\0]/.test(rel)                      // fluxo NTFS, nome curto 8.3, byte nulo
    || segmentos(rel).some(s => s.startsWith('.')) // .env, .git, .wwebjs_auth, e ".."
    || NEGADOS.test(rel);
}

/**
 * Classifica um caminho de URL JÁ DECODIFICADO (decodeURIComponent):
 *   'negado'      → responder 404
 *   'publico'     → pode servir (se existir)
 *   'desconhecido'→ não é da interface: o servidor responde como faria com
 *                   arquivo inexistente (página principal), sem revelar nada
 */
export function classificarCaminho(decodificado) {
  const rel = String(decodificado || '').replace(/^[\\/]+/, '');
  if (rel === '') return 'publico';                 // "/" → index.html
  if (caminhoProibido(rel)) return 'negado';
  if (PUBLICOS_RAIZ.has(rel.toLowerCase())) return 'publico';
  if (/^assets[\\/]/i.test(rel)) return 'publico';
  return 'desconhecido';
}

/** O último segmento tem extensão de arquivo? ("/sentinela" não; "/robots.txt" sim) */
export const pareceArquivo = rel => /\.[a-z0-9]{1,12}$/i.test(String(rel).split(/[\\/]/).pop() || '');

/**
 * Destino de um pedido de estático já classificado.
 *   'servir'    → entrega o arquivo pedido (público e existente)
 *   'principal' → rota sem extensão (/sentinela, /cerebro): página principal
 *   '404'       → ARQUIVO inexistente ou fora da interface
 * Antes, tudo que não existia caía na página principal com 200 ("soft 404"):
 * o Lighthouse leu o index.html como robots.txt (394 erros) e um módulo .js
 * ausente chegava como HTML, com erro de MIME no lugar de um 404 claro.
 * `existe` só é consultado para caminho PÚBLICO: fora da lista, existir ou
 * não dá a mesma resposta — nenhum oráculo de arquivos do servidor.
 */
export function destinoEstatico(rel, classe, existe) {
  if (classe === 'negado') return '404';
  if (classe === 'publico' && existe) return 'servir';
  return pareceArquivo(rel) ? '404' : 'principal';
}

/* ═══════════════════ ENTREGA: compressão, ETag e 304 ═══════════════════
   Medido no Lighthouse (mobile, 1ª visita à Sentinela): 27,3 MB trafegados,
   nada comprimido — o WASM do MediaPipe sozinho tinha 13,5 MB. Em brotli
   (qualidade 5) ele cai para 3,3 MB (24%); JS/CSS/HTML para ~30%. Os modelos
   .tflite/.task são pesos float16 e encolhem só ~12%: não entram.
   O corpo comprimido é calculado UMA vez por versão do arquivo (tamanho +
   mtime), no pool de threads do libuv (assíncrono, sem travar o servidor),
   e guardado num cache LRU com teto de memória. */

/** Extensões que valem compressão (woff2 já vem comprimido em brotli: fica de fora). */
export const COMPRIMIVEIS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.map', '.wasm']);
const MIN_COMPRIMIR = 1024;   // abaixo de 1 KiB o cabeçalho come o ganho
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/**
 * Escolhe a codificação pelo Accept-Encoding, respeitando os pesos q
 * (RFC 9110 §12.5.3): maior q vence, empate favorece brotli, q=0 recusa.
 * @returns {'br'|'gzip'|null}
 */
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
  candidatos.sort((a, b) => b[1] - a[1]);       // sort estável: no empate, br (1º) fica na frente
  return candidatos[0][0];
}

/** ETag forte por versão do arquivo E por codificação (cada representação tem a sua). */
export function etagDe(st, cod = null) {
  const sufixo = cod === 'br' ? '-br' : cod === 'gzip' ? '-gz' : '';
  return `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${sufixo}"`;
}

/** If-None-Match (comparação fraca, RFC 9110 §13.1.2): lista, "*" e prefixo W/. */
export function casaETag(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === '*') return true;
  const opaca = t => t.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some(t => opaca(t) === opaca(etag));
}

/**
 * Entregador de arquivos com cache dos corpos comprimidos.
 * @param {{ maxBytes?: number }} [op] teto de memória do cache (padrão 64 MiB)
 */
export function criarEntregador({ maxBytes = 64 * 2 ** 20 } = {}) {
  /** chave → { promessa, bytes } — Map preserva a ordem de inserção: o 1º é o mais antigo */
  const cache = new Map();
  let total = 0;

  const despejar = () => {
    for (const [chave, item] of cache) {
      if (total <= maxBytes) break;
      if (item.bytes == null) continue;          // ainda comprimindo: não dá para medir nem soltar
      cache.delete(chave); total -= item.bytes;
    }
  };

  function comprimido(arquivo, st, cod) {
    const chave = `${arquivo}|${st.size}|${st.mtimeMs}|${cod}`;
    const achado = cache.get(chave);
    if (achado) { cache.delete(chave); cache.set(chave, achado); return achado.promessa; }   // LRU: renova
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

  /**
   * Responde com o arquivo: 304 se o cliente já tem esta versão; comprimido se
   * o tipo compensa e o cliente aceita; senão, fluxo direto do disco.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} arquivo caminho absoluto JÁ validado pelo chamador
   * @param {{ tipo: string, cacheControl: string, cabecalhos?: object, st?: fs.Stats }} op
   */
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

/** Instância única do processo (estáticos da interface + runtime do MediaPipe). */
export const ENTREGADOR = criarEntregador();
