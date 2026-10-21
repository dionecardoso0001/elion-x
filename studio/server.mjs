/**
 * ADVANCED TECH TI · STUDIO — servidor
 *
 * Node puro (sem framework), no mesmo espírito do ELION-X: cada linha aqui
 * é auditável. Fluxo do negócio:
 *
 *   briefing → orçamento (servidor) → pedido + checkout → webhook do
 *   pagamento → despacho assinado ao bot Grok → callback assinado do bot
 *   → entrega na página do pedido.
 *
 * Execução: `node server.mjs` (lê .env da pasta studio, se existir).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicCatalog, quote, findPackage } from './lib/catalog.mjs';
import { validateOrderInput, httpsUrl, ValidationError } from './lib/validate.mjs';
import { createStore } from './lib/store.mjs';
import { paymentProvider } from './lib/payments.mjs';
import { dispatchToBot, assistEnabled, suggestScript } from './lib/grok.mjs';
import { randomToken, sha256, safeEqual, orderId, verifyBody } from './lib/crypto.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');

/* ── .env mínimo (sem dependência) ───────────────────────────────────── */
export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/* ── utilidades HTTP ─────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(res, isProd) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'corpo grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'envie application/json');
  const raw = await readBody(req, limit);
  try { return JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON inválido'); }
}

/* ── limitação de taxa (janela fixa por IP + rota) ───────────────────── */
function rateLimiter() {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();
  return (key, max, windowMs) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}

/* ── visão pública do pedido (sem hash de token, sem dados de pagamento) */
function publicOrder(o) {
  return {
    id: o.id, status: o.status, progress: o.progress, createdAt: o.createdAt, updatedAt: o.updatedAt, dueAt: o.dueAt,
    packageId: o.packageId, packageName: o.packageName, kind: o.kind, deliverables: o.deliverables,
    quote: o.quote, briefing: o.briefing, customer: { name: o.customer.name, email: o.customer.email },
    timeline: o.timeline, assets: o.assets, revisionsLeft: o.revisionsLeft,
  };
}

const STATUS_TEXT = {
  awaiting_payment: 'Aguardando pagamento',
  paid: 'Pagamento confirmado — enviando para o estúdio de IA',
  in_production: 'Em produção',
  delivered: 'Entregue',
  revision_requested: 'Ajuste solicitado',
  failed: 'Falha na produção — nossa equipe foi avisada',
  canceled: 'Cancelado',
};

/* ═════════════════════════════════════════════════════════════════════ */
export async function createApp(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3333);
  const baseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const payments = paymentProvider(env);

  if (isProd) {
    if (payments.name === 'mock') throw new Error('PAYMENT_PROVIDER=mock é proibido em produção');
    if (!env.PUBLIC_BASE_URL?.startsWith('https://')) throw new Error('PUBLIC_BASE_URL https:// é obrigatório em produção');
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) throw new Error('ADMIN_TOKEN com 32+ caracteres é obrigatório em produção');
    if (!env.BOT_SHARED_SECRET || env.BOT_SHARED_SECRET.length < 32) throw new Error('BOT_SHARED_SECRET com 32+ caracteres é obrigatório em produção');
  }

  const store = await createStore(env.DATA_FILE || join(ROOT, 'data', 'orders.json'));
  const allow = rateLimiter();
  const seenSignatures = new Map(); // anti-replay do callback dos bots
  const deliveryHosts = (env.DELIVERY_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const clientIp = req => (env.TRUST_PROXY === '1'
    ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    : '') || req.socket.remoteAddress || '?';

  const log = (event, data = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));

  const pushTimeline = (o, status, message) => {
    o.status = status;
    o.timeline.push({ at: new Date().toISOString(), status, message: message || STATUS_TEXT[status] });
    if (o.timeline.length > 60) o.timeline.splice(0, o.timeline.length - 60);
  };

  /* ── autenticação ─────────────────────────────────────────────────── */
  const bearer = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  function requireOrderAccess(req, id) {
    const o = store.get(id);
    const token = bearer(req);
    // Mesma resposta para "não existe" e "token errado": não revela quais ids existem.
    if (!o || !token || !safeEqual(sha256(token), o.tokenHash)) throw new HttpError(404, 'pedido não encontrado');
    return o;
  }

  function requireAdmin(req) {
    if (!env.ADMIN_TOKEN || !safeEqual(bearer(req), env.ADMIN_TOKEN)) throw new HttpError(401, 'não autorizado');
  }

  /* ── pagamento confirmado (idempotente) ───────────────────────────── */
  async function markPaid(id, { provider, sessionId, amountCents }) {
    const updated = await store.update(id, o => {
      if (o.status !== 'awaiting_payment') return; // webhook repetido: ignora
      if (amountCents !== undefined && amountCents !== o.quote.totalCents) {
        log('payment.amount_mismatch', { id, expected: o.quote.totalCents, got: amountCents });
        return;
      }
      o.payment = { provider, sessionId, paidAt: new Date().toISOString() };
      o.dueAt = new Date(Date.now() + o.quote.slaHours * 3600_000).toISOString();
      o.dispatch = { attempts: 0, nextAttemptAt: Date.now(), lastError: null };
      pushTimeline(o, 'paid');
    });
    if (updated?.status === 'paid') { log('order.paid', { id, provider }); runDispatch(id); }
    return updated;
  }

  /* ── despacho aos bots com nova tentativa exponencial ─────────────── */
  const inFlight = new Set();
  async function runDispatch(id, event = 'order.paid', extra) {
    if (inFlight.has(id)) return;
    inFlight.add(id);
    try {
      const o = store.get(id);
      if (!o || !['paid', 'revision_requested'].includes(o.status)) return;
      const r = await dispatchToBot(o, { baseUrl, env, event, extra });
      await store.update(id, x => {
        x.dispatch.attempts += 1;
        if (r.ok) {
          x.dispatch.lastError = null;
          x.dispatch.nextAttemptAt = null;
          x.dispatch.dispatchedAt = new Date().toISOString();
          x.progress = Math.max(x.progress, 10);
          pushTimeline(x, 'in_production', 'Briefing entregue ao bot Grok — produção iniciada');
        } else {
          x.dispatch.lastError = r.error;
          // 30 s, 1 min, 2 min, 4 min, 8 min… teto de 30 min; para após 8 tentativas.
          x.dispatch.nextAttemptAt = x.dispatch.attempts >= 8 ? null : Date.now() + Math.min(30_000 * 2 ** (x.dispatch.attempts - 1), 1_800_000);
        }
      });
      log(r.ok ? 'bot.dispatched' : 'bot.dispatch_failed', { id, botEvent: event, error: r.error });
    } finally {
      inFlight.delete(id);
    }
  }

  const worker = setInterval(() => {
    for (const o of store.list()) {
      if (['paid', 'revision_requested'].includes(o.status) && o.dispatch?.nextAttemptAt && o.dispatch.nextAttemptAt <= Date.now()) {
        runDispatch(o.id, o.status === 'revision_requested' ? 'order.revision' : 'order.paid', o.status === 'revision_requested' ? { revisionNote: o.lastRevisionNote } : undefined);
      }
    }
  }, 15_000);
  worker.unref();

  /* ── validação dos arquivos entregues pelo bot ────────────────────── */
  function validateAssets(list) {
    if (!Array.isArray(list) || list.length > 40) throw new HttpError(400, 'assets inválidos');
    return list.map((a, i) => {
      const url = httpsUrl(a?.url, `assets[${i}].url`);
      if (deliveryHosts.length && !deliveryHosts.includes(new URL(url).hostname.toLowerCase())) {
        throw new HttpError(400, `assets[${i}]: host não permitido`);
      }
      const type = a?.type === 'image' ? 'image' : a?.type === 'video' ? 'video' : null;
      if (!type) throw new HttpError(400, `assets[${i}].type deve ser video ou image`);
      return {
        type, url,
        thumbnail: a.thumbnail ? httpsUrl(a.thumbnail, `assets[${i}].thumbnail`) : null,
        label: String(a.label || (type === 'video' ? 'Vídeo' : 'Imagem')).slice(0, 80),
      };
    });
  }

  /* ── rotas ────────────────────────────────────────────────────────── */
  async function api(req, res, url) {
    const ip = clientIp(req);
    const path = url.pathname;
    const m = (method, re) => req.method === method && path.match(re);
    let p;

    if (m('GET', /^\/api\/health$/)) return json(res, 200, { ok: true, payments: payments.name, assistant: assistEnabled(env) });

    if (m('GET', /^\/api\/catalog$/)) return json(res, 200, { ...publicCatalog(), assistant: assistEnabled(env), payments: payments.name });

    if (m('POST', /^\/api\/quote$/)) {
      if (!allow(`q:${ip}`, 90, 60_000)) throw new HttpError(429, 'muitas requisições');
      const b = await readJson(req, 4096);
      return json(res, 200, quote(String(b.packageId || ''), Array.isArray(b.addons) ? b.addons.map(String) : []));
    }

    if (m('POST', /^\/api\/assist\/script$/)) {
      if (!assistEnabled(env)) throw new HttpError(503, 'assistente de roteiro desligado');
      if (!allow(`a:${ip}`, 6, 10 * 60_000)) throw new HttpError(429, 'limite do assistente atingido — tente em alguns minutos');
      const b = await readJson(req, 8192);
      const draft = validateOrderInput({
        packageId: b.packageId, addons: [], acceptTerms: true,
        briefing: { ...b.briefing, references: [] }, customer: { name: 'Rascunho', email: 'rascunho@exemplo.com' },
      });
      const pkg = findPackage(draft.packageId);
      const script = await suggestScript(draft.briefing, { durationSec: pkg.durationSec || 15, env });
      return json(res, 200, { script });
    }

    if (m('POST', /^\/api\/orders$/)) {
      if (!allow(`o:${ip}`, 10, 10 * 60_000)) throw new HttpError(429, 'muitos pedidos em sequência — aguarde alguns minutos');
      const input = validateOrderInput(await readJson(req));
      const q = quote(input.packageId, input.addons);
      const pkg = findPackage(input.packageId);
      const token = randomToken();
      const now = new Date().toISOString();
      const order = {
        id: orderId(), tokenHash: sha256(token), createdAt: now, updatedAt: now,
        status: 'awaiting_payment', progress: 0,
        packageId: pkg.id, packageName: pkg.name, kind: pkg.kind, durationSec: pkg.durationSec,
        deliverables: pkg.deliverables, quote: q, briefing: input.briefing, customer: input.customer,
        payment: null, dispatch: null, dueAt: null, assets: [],
        revisionsLeft: pkg.revisions, revisionsUsed: 0,
        timeline: [{ at: now, status: 'awaiting_payment', message: 'Pedido criado' }],
      };
      await store.insert(order);
      let checkout;
      try {
        checkout = await payments.createCheckout({ order, baseUrl });
      } catch (e) {
        log('checkout.error', { id: order.id, error: e.message, detail: e.detail });
        throw new HttpError(502, 'não foi possível abrir o pagamento agora — tente novamente');
      }
      await store.update(order.id, o => { o.payment = { provider: payments.name, sessionId: checkout.sessionId, paidAt: null }; });
      log('order.created', { id: order.id, package: pkg.id, total: q.totalCents });
      return json(res, 201, {
        id: order.id, accessToken: token, checkoutUrl: checkout.url,
        trackUrl: `${baseUrl}/pedido.html?id=${order.id}#t=${token}`,
      });
    }

    if ((p = m('GET', /^\/api\/orders\/(AT-[A-Z0-9]{8})$/))) {
      if (!allow(`g:${ip}`, 120, 60_000)) throw new HttpError(429, 'muitas requisições');
      return json(res, 200, publicOrder(requireOrderAccess(req, p[1])));
    }

    if ((p = m('POST', /^\/api\/orders\/(AT-[A-Z0-9]{8})\/revision$/))) {
      if (!allow(`r:${ip}`, 10, 60 * 60_000)) throw new HttpError(429, 'muitas requisições');
      const o = requireOrderAccess(req, p[1]);
      const b = await readJson(req, 4096);
      const note = String(b.note || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 1000);
      if (note.length < 10) throw new HttpError(400, 'descreva o ajuste (mínimo 10 caracteres)');
      if (o.status !== 'delivered') throw new HttpError(409, 'ajustes só podem ser pedidos após a entrega');
      if (o.revisionsLeft <= 0) throw new HttpError(409, 'as rodadas de ajuste deste pacote acabaram');
      await store.update(o.id, x => {
        x.revisionsLeft -= 1;
        x.revisionsUsed += 1;
        x.lastRevisionNote = note;
        x.progress = 10;
        x.dispatch = { ...x.dispatch, nextAttemptAt: Date.now(), lastError: null };
        pushTimeline(x, 'revision_requested', `Ajuste solicitado: ${note.slice(0, 140)}`);
      });
      runDispatch(o.id, 'order.revision', { revisionNote: note });
      return json(res, 200, publicOrder(store.get(o.id)));
    }

    /* Webhook do Stripe — corpo BRUTO para verificar a assinatura. */
    if (m('POST', /^\/api\/webhooks\/stripe$/)) {
      if (payments.name !== 'stripe') throw new HttpError(404, 'não encontrado');
      const raw = await readBody(req, 512 * 1024);
      const evt = payments.parseWebhook(raw, req.headers['stripe-signature']);
      if (!evt) throw new HttpError(400, 'assinatura inválida');
      const s = evt.data?.object || {};
      const id = s.metadata?.order_id || s.client_reference_id;
      const paidNow = (evt.type === 'checkout.session.completed' && s.payment_status === 'paid')
        || evt.type === 'checkout.session.async_payment_succeeded';
      if (paidNow && id) await markPaid(id, { provider: 'stripe', sessionId: s.id, amountCents: s.amount_total });
      return json(res, 200, { received: true });
    }

    /* Pagamento simulado — só existe com o provedor mock (bloqueado em produção). */
    if (m('POST', /^\/api\/dev\/mock-pay$/)) {
      if (payments.name !== 'mock') throw new HttpError(404, 'não encontrado');
      const b = await readJson(req, 1024);
      const o = requireOrderAccess(req, String(b.id || ''));
      const r = await markPaid(o.id, { provider: 'mock', sessionId: `mock_${o.id}` });
      return json(res, 200, publicOrder(r));
    }

    /* Retorno dos bots Grok — assinado com BOT_SHARED_SECRET. */
    if (m('POST', /^\/api\/bots\/callback$/)) {
      if (!allow(`cb:${ip}`, 600, 60_000)) throw new HttpError(429, 'muitas requisições');
      const raw = await readBody(req, 256 * 1024);
      const ts = req.headers['x-studio-timestamp'];
      const sig = req.headers['x-studio-signature'];
      if (!verifyBody(env.BOT_SHARED_SECRET, raw, ts, sig)) throw new HttpError(401, 'assinatura inválida');
      if (seenSignatures.has(sig)) return json(res, 200, { ok: true, duplicate: true });
      seenSignatures.set(sig, Date.now());
      for (const [k, t] of seenSignatures) if (Date.now() - t > 600_000) seenSignatures.delete(k);

      let b;
      try { b = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido'); }
      const status = b.status;
      if (!['in_production', 'delivered', 'failed'].includes(status)) throw new HttpError(400, 'status inválido');
      const assets = status === 'delivered' ? validateAssets(b.assets) : [];
      if (status === 'delivered' && !assets.length) throw new HttpError(400, 'entrega sem arquivos');
      const message = b.message ? String(b.message).replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 200) : undefined;

      let ignored = false;
      const updated = await store.update(String(b.orderId || ''), o => {
        if (!['paid', 'in_production', 'revision_requested'].includes(o.status)) { ignored = true; return; }
        const progress = Number.isFinite(b.progress) ? Math.max(0, Math.min(100, Math.round(b.progress))) : o.progress;
        if (status === 'in_production') {
          o.progress = Math.max(o.progress, progress);
          if (o.status !== 'in_production' || message) pushTimeline(o, 'in_production', message);
        } else if (status === 'delivered') {
          o.assets = assets;
          o.progress = 100;
          pushTimeline(o, 'delivered', message || 'Seu material está pronto para download');
        } else {
          pushTimeline(o, 'failed', message);
        }
      });
      if (!updated) throw new HttpError(404, 'pedido não encontrado');
      log(ignored ? 'bot.callback_ignored' : 'bot.callback', { id: updated.id, status, orderStatus: updated.status });
      return json(res, 200, { ok: true, ignored });
    }

    /* ── administração ── */
    if (m('GET', /^\/api\/admin\/orders$/)) {
      requireAdmin(req);
      return json(res, 200, store.list().map(o => ({ ...publicOrder(o), customer: o.customer, dispatch: o.dispatch, payment: o.payment })));
    }
    if ((p = m('POST', /^\/api\/admin\/orders\/(AT-[A-Z0-9]{8})\/dispatch$/))) {
      requireAdmin(req);
      const o = store.get(p[1]);
      if (!o) throw new HttpError(404, 'pedido não encontrado');
      if (!['paid', 'revision_requested'].includes(o.status)) throw new HttpError(409, `não dá para despachar no status ${o.status}`);
      await runDispatch(o.id, o.status === 'revision_requested' ? 'order.revision' : 'order.paid', o.status === 'revision_requested' ? { revisionNote: o.lastRevisionNote } : undefined);
      return json(res, 200, store.get(o.id).dispatch);
    }
    if ((p = m('POST', /^\/api\/admin\/orders\/(AT-[A-Z0-9]{8})\/deliver$/))) {
      requireAdmin(req);
      const b = await readJson(req, 64 * 1024);
      const assets = validateAssets(b.assets);
      if (!assets.length) throw new HttpError(400, 'informe ao menos um arquivo');
      const r = await store.update(p[1], o => {
        if (o.status === 'awaiting_payment' || o.status === 'canceled') throw new HttpError(409, 'pedido não pago');
        o.assets = assets;
        o.progress = 100;
        pushTimeline(o, 'delivered', 'Entregue pela equipe Advanced Tech TI');
      });
      if (!r) throw new HttpError(404, 'pedido não encontrado');
      return json(res, 200, publicOrder(r));
    }

    throw new HttpError(404, 'rota inexistente');
  }

  async function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'método não permitido');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + sep)) throw new HttpError(404, 'não encontrado'); // path traversal
    let st;
    try { st = await stat(file); } catch { throw new HttpError(404, 'não encontrado'); }
    if (!st.isFile()) throw new HttpError(404, 'não encontrado');
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'Content-Length': st.size,
    });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  }

  const server = createServer(async (req, res) => {
    securityHeaders(res, isProd);
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || (e instanceof ValidationError ? 400 : 500);
      if (status >= 500) log('error', { path: url.pathname, error: e.message });
      if (res.headersSent) return res.end();
      if (url.pathname.startsWith('/api/')) {
        json(res, status, { error: status >= 500 && !(e instanceof HttpError) ? 'erro interno' : e.message, field: e.field });
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(status === 404 ? 'Página não encontrada' : 'Erro');
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  return { server, store, port, baseUrl, close: () => { clearInterval(worker); return new Promise(r => server.close(r)); } };
}

/* ── execução direta ─────────────────────────────────────────────────── */
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  loadEnv();
  const app = await createApp();
  app.server.listen(app.port, () => console.log(`\n  ADVANCED TECH TI · STUDIO  →  ${app.baseUrl}\n`));
}
