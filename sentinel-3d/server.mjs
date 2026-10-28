// SENTINEL 3D — servidor HTTP (Node puro, sem framework).
// API REST + SSE + arquivos estáticos, com cabeçalhos de segurança e autorização no servidor.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Platform } from './src/platform.mjs';
import { Store } from './src/infra/store.mjs';
import { Sessions, parseCookies } from './src/security/auth.mjs';
import { createApi } from './src/http/api.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

export function createServer({ port = 0, dataDir = path.join(ROOT, 'data'), tickMs = 1000, ingestToken = process.env.SENTINEL_INGEST_TOKEN || '', demoAuth = process.env.SENTINEL_DEMO_AUTH !== '0', host = process.env.HOST || '127.0.0.1', mode = process.env.SENTINEL_MODE || 'demo' } = {}) {
  if (mode === 'integracao' && String(ingestToken).length < 32) {
    // sem token forte não existe integração segura: falha na partida, não em produção
    throw new Error('Modo integração exige SENTINEL_INGEST_TOKEN com pelo menos 32 caracteres (gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))")');
  }
  const store = new Store(dataDir);
  const platform = new Platform({ store, ingestToken, mode });
  const ingestLimiter = rateLimiter({ max: 240, windowMs: 60_000 }); // por origem: ~4 lotes/s
  const sessions = new Sessions();
  store.prune(platform.config.retentionDays);

  // CSP: o import map inline é autorizado por hash calculado na inicialização.
  const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const importMap = indexHtml.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '';
  const importMapHash = crypto.createHash('sha256').update(importMap).digest('base64');
  const CSP = [
    "default-src 'self'", `script-src 'self' 'sha256-${importMapHash}'`, "style-src 'self'", "img-src 'self' data: blob:",
    "connect-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; ');

  const audit = (session, action, target, extra = {}) => {
    const entry = { ts: Date.now(), user: session?.user ?? 'anônimo', role: session?.role ?? null, action, target, ...extra };
    store.appendAudit(entry);
    auditLog.push(entry); if (auditLog.length > 2000) auditLog.shift();
  };
  const auditLog = store.loadAudit();

  const timer = setInterval(() => platform.cycle(Date.now()), tickMs);
  timer.unref?.();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    setSecurityHeaders(res, CSP);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      if (err.code === 'PAYLOAD_TOO_LARGE') return json(res, 413, { error: 'payload grande demais' });
      console.error('[erro]', err);
      return json(res, 500, { error: 'erro interno' }); // sem stack trace para o cliente
    }
  });

  const core = createApi({
    platform, sessions, store, audit, auditLog, demoAuth,
    brandLogo: () => (fs.existsSync(path.join(PUBLIC, 'brand', 'logo.png')) ? '/brand/logo.png' : null),
    uptimeS: () => process.uptime(),
  });

  // Adaptador HTTP: transporte, cookies, CSRF e SSE. Rotas e autorização vivem em src/http/api.mjs.
  async function api(req, res, url) {
    const session = sessions.get(parseCookies(req.headers.cookie).sid);
    const method = req.method;
    const p = url.pathname;

    // Mutação exige: JSON + cabeçalho anti-CSRF + mesma origem (cookie já é SameSite=Strict)
    if (method !== 'GET' && p !== '/api/ingest') {
      if (req.headers['x-sentinel-csrf'] !== '1') return json(res, 403, { error: 'cabeçalho anti-CSRF ausente' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'origem não permitida' });
    }

    // Ingestão por gateway (conector real) — token próprio, separado das sessões humanas.
    if (p === '/api/ingest' && method === 'POST') {
      if (!platform.ingestEnabled) return json(res, 404, { error: 'ingestão externa desabilitada' });
      if (!ingestLimiter(req.socket.remoteAddress)) return json(res, 429, { error: 'limite de requisições excedido; agrupe leituras em lotes (até 500)' });
      const auth = req.headers.authorization || '';
      if (!(auth.startsWith('Bearer ') && safeEqual(auth.slice(7), ingestToken))) return json(res, 401, { error: 'token inválido' });
      const body = await readJson(req, 256 * 1024);
      const list = Array.isArray(body?.readings) ? body.readings.slice(0, 500) : [];
      const results = list.map((r) => { const x = platform.ingest(r, 'ingest-api', Date.now()); return x.ok ? { ok: true, deviceId: r.deviceId, dropped: x.reading.dropped } : { ok: false, error: x.error }; });
      return json(res, 202, { accepted: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length, results });
    }

    if (p === '/api/stream') {
      if (!session) return json(res, 401, { error: 'sessão necessária' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const unsub = core.subscribe(session, (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      req.on('close', unsub);
      return;
    }

    const body = method === 'GET' ? null : await readJson(req);
    const r = core.handle({ method, path: p, query: url.searchParams, body, session });
    if (r.newSession) res.setHeader('Set-Cookie', `sid=${r.newSession.sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
    if (r.text !== undefined) {
      res.writeHead(r.status, { 'Content-Type': r.contentType, 'Content-Disposition': `attachment; filename="${r.filename}"`, 'Cache-Control': 'no-store' });
      return res.end(r.text);
    }
    return json(res, r.status, r.body);
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'método não permitido' });
    let base = PUBLIC;
    let rel = pathname === '/' ? '/index.html' : pathname;
    if (rel.startsWith('/vendor/three/')) { base = THREE_DIR; rel = rel.slice('/vendor/three'.length); }
    const file = path.normalize(path.join(base, decodeURIComponent(rel)));
    if (!file.startsWith(base + path.sep)) return json(res, 403, { error: 'caminho inválido' }); // path traversal
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('não encontrado'); }
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': base === THREE_DIR ? 'public, max-age=86400' : 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, platform, port: server.address().port, close: () => { clearInterval(timer); store.flush(platform.incidents.incidents); return new Promise((r) => server.close(r)); } }));
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function setSecurityHeaders(res, csp) {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), xr-spatial-tracking=(self)');
}

function json(res, code, body) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return resolve(null);
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error('payload grande demais'), { code: 'PAYLOAD_TOO_LARGE' })); req.resume(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

/** Janela fixa por chave (origem). Suficiente para um processo; em cluster, usar Redis. */
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// execução direta
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8730;
  process.on('unhandledRejection', (e) => { console.error(`\n  ✖ ${e.message}\n`); process.exit(1); });
  Promise.resolve().then(() => createServer({ port })).then(({ port: p, close, platform }) => {
    const banner = platform.simulate ? 'MODO DEMONSTRAÇÃO (dados simulados)' : 'MODO INTEGRAÇÃO (sem simulador; telemetria só via POST /api/ingest)';
    console.log(`\n  SENTINEL 3D — ${banner}\n  Abra no navegador: http://localhost:${p}\n`);
    if (!platform.simulate && process.env.SENTINEL_DEMO_AUTH !== '0') console.warn('  ⚠ Autenticação de DEMONSTRAÇÃO ativa: qualquer pessoa com acesso à porta escolhe o perfil. Use somente em laboratório isolado até integrar o IdP corporativo.\n');
    const stop = () => close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  });
}
