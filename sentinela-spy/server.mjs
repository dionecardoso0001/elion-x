/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — servidor próprio (Node puro + SDK oficial da Anthropic)

     npm run preparar   (uma vez)
     npm start          → http://localhost:4040

   Entrega a interface (lista de permissão, brotli/gzip, ETag) e hospeda o
   agente no MODO SERVIDOR: a chave da API fica aqui, em variável de
   ambiente (.env), e o navegador nunca a vê. O cliente manda só a tarefa
   e as mensagens; modelo, prompt e ferramentas são montados AQUI
   (js/spy/cerebro.js) — ninguém usa esta chave para outra coisa.

   Variáveis (.env ao lado deste arquivo ou ambiente):
     ANTHROPIC_API_KEY   chave da API (sem ela o agente fica no modo chave própria)
     SPY_TOKEN           token de acesso ao agente — OBRIGATÓRIO se expuser na rede
     PORT                padrão 4040
     HOST                padrão 127.0.0.1 (só este computador)
   ═══════════════════════════════════════════════════════════════════════ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { classificarCaminho, caminhoProibido, criarEntregador, CABECALHOS_SEGURANCA } from './estaticos.mjs';
import { MODELO, montarPedido, validarMensagens } from './js/spy/cerebro.js';
import { VERSAO, MEDIAPIPE_VERSAO } from './js/config.js';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_REAL = fs.realpathSync.native(RAIZ);

/** .env mínimo (CHAVE=valor), sem sobrescrever o ambiente — sem dependência extra. */
export function carregarEnv(arquivo, env = process.env) {
  let texto;
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return 0; }
  let n = 0;
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith('#')) continue;
    const valor = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (env[m[1]] === undefined) { env[m[1]] = valor; n++; }
  }
  return n;
}

/** Balde de fichas: um laço descontrolado no cliente não queima o orçamento da API. */
export function criarLimitador({ porMinuto = 12, agora = () => Date.now() } = {}) {
  let fichas = porMinuto, ultimo = agora();
  return {
    permitir() {
      const t = agora();
      fichas = Math.min(porMinuto, fichas + ((t - ultimo) / 60000) * porMinuto);
      ultimo = t;
      if (fichas < 1) return false;
      fichas -= 1;
      return true;
    },
  };
}

/** Comparação de token em tempo constante (não vaza o token por cronometragem). */
export function tokenConfere(cabecalho, token) {
  if (!token) return true;
  const m = /^Bearer\s+(.+)$/.exec(cabecalho || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest();
  const b = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Erro tipado do SDK → status e mensagem para o operador (mais específico primeiro). */
export function traduzirErroApi(e, A = Anthropic) {
  if (e instanceof A.AuthenticationError) return { status: 502, erro: 'A chave da API configurada no servidor foi recusada (401). Confira o .env.' };
  if (e instanceof A.PermissionDeniedError) return { status: 502, erro: 'A chave do servidor não tem permissão para este modelo (403).' };
  if (e instanceof A.RateLimitError) return { status: 429, erro: 'Limite de uso da API atingido (429). O agente volta em instantes.', tentar_em_s: 20 };
  if (e instanceof A.BadRequestError) return { status: 502, erro: `A API recusou o pedido (400): ${e.message}` };
  if (e instanceof A.APIConnectionError) return { status: 503, erro: 'Sem conexão com a API da Anthropic a partir do servidor.' };
  if (e instanceof A.APIError) return { status: 502, erro: `API da Anthropic indisponível (${e.status ?? '?'}).` };
  return { status: 500, erro: 'Falha interna ao consultar o agente.' };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.task': 'application/octet-stream',
};

function cacheControlPara(rel) {
  if (rel.startsWith('vendor/mediapipe/')) return 'public, max-age=31536000, immutable';   // versão no caminho
  if (rel.startsWith('modelos/')) return 'public, max-age=604800';                          // + ETag; SHA-256 no cliente
  if (/\.(woff2|png|svg)$/.test(rel)) return 'public, max-age=86400';
  return 'no-cache';                                                                         // revalida sempre (304)
}

export function criarServidor({ env = process.env, cliente = undefined } = {}) {
  const TOKEN = env.SPY_TOKEN || '';
  const temCredencial = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const agente = cliente !== undefined ? cliente : (temCredencial ? new Anthropic({ maxRetries: 2, timeout: 120_000 }) : null);
  const limitador = criarLimitador({ porMinuto: Number(env.SPY_LIMITE_MIN) || 12 });
  const entregador = criarEntregador();

  const json = (res, status, obj, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CABECALHOS_SEGURANCA, ...extra });
    res.end(JSON.stringify(obj));
  };
  const naoEncontrado = res => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...CABECALHOS_SEGURANCA }); res.end('Não encontrado'); };

  const lerCorpo = (req, limite = 13 * 2 ** 20) => new Promise((ok, falha) => {
    const partes = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limite) { falha(new Error('pedido grande demais')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });

  async function apiMensagens(req, res) {
    if (!agente) return json(res, 503, { erro: 'Este servidor não tem chave da API (ANTHROPIC_API_KEY). Use o modo "chave própria" nas configurações do agente.' });
    if (!tokenConfere(req.headers.authorization, TOKEN)) return json(res, 401, { erro: 'Token de acesso ao agente inválido ou ausente.' });
    if (!limitador.permitir()) return json(res, 429, { erro: 'Muitas consultas ao agente em sequência — aguarde alguns segundos.', tentar_em_s: 10 }, { 'Retry-After': '10' });
    let corpo;
    try { corpo = JSON.parse(await lerCorpo(req)); } catch (e) { return json(res, 400, { erro: e.message === 'pedido grande demais' ? e.message : 'JSON inválido' }); }
    let pedido;
    try { validarMensagens(corpo?.tipo, corpo?.messages); pedido = montarPedido(corpo.tipo, corpo.messages); }
    catch (e) { return json(res, 400, { erro: e.message }); }
    // o operador fechou a aba: cancela a chamada em vez de pagar por uma resposta que ninguém lê
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    try {
      const msg = await agente.beta.messages.create(pedido, { signal: ac.signal });
      return json(res, 200, msg);
    } catch (e) {
      if (ac.signal.aborted) return res.destroy();
      const { status, erro, tentar_em_s } = traduzirErroApi(e);
      if (status >= 500) console.error('[agente]', e?.status ?? '', e?.message);
      return json(res, status, { erro, ...(tentar_em_s ? { tentar_em_s } : {}) }, tentar_em_s ? { 'Retry-After': String(tentar_em_s) } : {});
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/spy/estado' && req.method === 'GET') {
        return json(res, 200, { disponivel: !!agente, exige_token: !!TOKEN, modelo: agente ? MODELO : null, versao: VERSAO });
      }
      if (url.pathname === '/api/spy/mensagens') {
        if (req.method !== 'POST') return json(res, 405, { erro: 'use POST' }, { Allow: 'POST' });
        return await apiMensagens(req, res);
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { erro: 'rota inexistente' });
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }

      let rel;
      try { rel = decodeURIComponent(url.pathname).replace(/^[\\/]+/, ''); } catch { return naoEncontrado(res); }
      if (rel === '') rel = 'index.html';
      if (classificarCaminho(rel) !== 'publico') return naoEncontrado(res);
      const arquivo = path.join(RAIZ, rel);
      let st;
      try { st = await fs.promises.stat(arquivo); } catch { return naoEncontrado(res); }
      if (!st.isFile()) return naoEncontrado(res);
      const relReal = path.relative(RAIZ_REAL, await fs.promises.realpath(arquivo));
      if (relReal.startsWith('..') || path.isAbsolute(relReal) || caminhoProibido(relReal)) return naoEncontrado(res);
      await entregador.servir(req, res, arquivo, {
        st, tipo: MIME[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
        cacheControl: cacheControlPara(rel.replace(/\\/g, '/')), cabecalhos: CABECALHOS_SEGURANCA,
      });
    } catch (e) {
      console.error('[servidor]', e.message);
      if (!res.headersSent) json(res, 500, { erro: 'falha interna' }); else res.destroy();
    }
  });
}

// ── execução direta (npm start) ──
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  carregarEnv(path.join(RAIZ, '.env'));
  const PORTA = Number(process.env.PORT) || 4040;
  const HOST = process.env.HOST || '127.0.0.1';
  const servidor = criarServidor();
  servidor.listen(PORTA, HOST, () => {
    const comChave = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    const local = fs.existsSync(path.join(RAIZ, 'plataforma.json'));
    console.log(`\n  ◤ SENTINELA SPY v${VERSAO} ◢`);
    console.log(`  interface   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`);
    console.log(`  agente      ${comChave ? `modo servidor · ${MODELO}` : 'sem chave no servidor → modo chave própria no navegador'}`);
    console.log(`  acesso      ${process.env.SPY_TOKEN ? 'token exigido (SPY_TOKEN)' : 'sem token'}`);
    console.log(`  runtime     ${local ? `local (MediaPipe ${MEDIAPIPE_VERSAO})` : 'NÃO preparado — rode: npm run preparar'}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost' && comChave && !process.env.SPY_TOKEN) {
      console.warn('\n  ⚠ Servidor exposto na rede COM chave da API e SEM SPY_TOKEN: qualquer um na rede gasta o seu crédito. Defina SPY_TOKEN.');
    }
    console.log('');
  });
  process.on('unhandledRejection', e => console.error('[rejeição]', e?.message || e));
}
