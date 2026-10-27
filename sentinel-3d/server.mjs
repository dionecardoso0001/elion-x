// SENTINEL 3D — servidor HTTP (Node puro, sem framework).
// API REST + SSE + arquivos estáticos, com cabeçalhos de segurança e autorização no servidor.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Platform } from './src/platform.mjs';
import { Store } from './src/infra/store.mjs';
import { ROLES, Sessions, can, parseCookies, sanitizeDevice, sanitizeIncident, redactText } from './src/security/auth.mjs';
import { answer, incidentReport } from './src/engine/assistant.mjs';
import { SCENARIOS } from './src/engine/simulator.mjs';
import { CONNECTORS } from './src/domain/connectors.mjs';
import { TYPES, CATEGORIES, STATUSES, EDGE_LABELS } from './src/domain/catalog.mjs';
import { STALE_FACTOR } from './src/engine/rules.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

export function createServer({ port = 0, dataDir = path.join(ROOT, 'data'), tickMs = 1000, ingestToken = process.env.SENTINEL_INGEST_TOKEN || '', demoAuth = process.env.SENTINEL_DEMO_AUTH !== '0' } = {}) {
  const store = new Store(dataDir);
  const platform = new Platform({ store, ingestToken });
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
      console.error('[erro]', err);
      return json(res, 500, { error: 'erro interno' }); // sem stack trace para o cliente
    }
  });

  async function api(req, res, url) {
    const session = sessions.get(parseCookies(req.headers.cookie).sid);
    const method = req.method;
    const p = url.pathname;
    const now = Date.now();

    // Mutação exige: JSON + cabeçalho anti-CSRF + mesma origem (cookie já é SameSite=Strict)
    if (method !== 'GET' && p !== '/api/ingest') {
      if (req.headers['x-sentinel-csrf'] !== '1') return json(res, 403, { error: 'cabeçalho anti-CSRF ausente' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'origem não permitida' });
    }

    if (p === '/api/health') return json(res, 200, { status: 'ok', uptimeS: Math.round(process.uptime()), devices: platform.devices.length, demo: true });

    if (p === '/api/session' && method === 'GET') return json(res, 200, { authenticated: !!session, role: session?.role ?? null });

    if (p === '/api/session' && method === 'POST') {
      if (!demoAuth) return json(res, 403, { error: 'autenticação de demonstração desabilitada — use o IdP corporativo' });
      const body = await readJson(req);
      const s = sessions.create(body?.role);
      if (!s) return json(res, 400, { error: 'perfil inválido' });
      if (session) sessions.destroy(session.sid);
      audit(s, 'session.create', s.role);
      res.setHeader('Set-Cookie', `sid=${s.sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
      return json(res, 200, { user: s.user, role: s.role, perms: ROLES[s.role].perms });
    }

    // Ingestão por gateway (conector real) — token próprio, separado das sessões humanas.
    if (p === '/api/ingest' && method === 'POST') {
      if (!platform.ingestEnabled) return json(res, 404, { error: 'ingestão externa desabilitada' });
      const auth = req.headers.authorization || '';
      const ok = auth.startsWith('Bearer ') && safeEqual(auth.slice(7), ingestToken);
      if (!ok) return json(res, 401, { error: 'token inválido' });
      const body = await readJson(req, 256 * 1024);
      const list = Array.isArray(body?.readings) ? body.readings.slice(0, 500) : [];
      const results = list.map((r) => { const x = platform.ingest(r, 'ingest-api', Date.now()); return x.ok ? { ok: true, deviceId: r.deviceId, dropped: x.reading.dropped } : { ok: false, error: x.error }; });
      return json(res, 202, { accepted: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length, results });
    }

    if (!session) return json(res, 401, { error: 'sessão necessária' });
    const need = (perm) => { if (!can(session, perm)) { audit(session, 'denied', p, { perm }); json(res, 403, { error: `permissão necessária: ${perm}` }); return false; } return true; };

    if (p === '/api/me') return json(res, 200, { user: session.user, role: session.role, roleLabel: ROLES[session.role].label, perms: ROLES[session.role].perms });

    if (p === '/api/meta') return json(res, 200, { types: TYPES, categories: CATEGORIES, statuses: STATUSES, edgeLabels: EDGE_LABELS, staleFactor: STALE_FACTOR, roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])) });

    if (p === '/api/agencies') return json(res, 200, platform.twin.agencies.map(({ id, name, city, timezone, demo, disclaimer }) => ({ id, name, city, timezone, demo, disclaimer })));

    let m;
    if ((m = p.match(/^\/api\/agencies\/([\w-]+)\/layout$/))) {
      const ag = platform.twin.agencies.find((a) => a.id === m[1]);
      if (!ag || !session.agencies.includes(ag.id)) return json(res, 404, { error: 'agência não encontrada' });
      return json(res, 200, ag);
    }

    if (p === '/api/state') return json(res, 200, snapshot(session, now));

    if (p === '/api/devices') {
      const list = visibleDevices(session, now).filter((d) => (!url.searchParams.get('category') || d.category === url.searchParams.get('category')) && (!url.searchParams.get('status') || d.status === url.searchParams.get('status')));
      return json(res, 200, list);
    }

    if ((m = p.match(/^\/api\/devices\/([\w-]+)$/)) && method === 'GET') {
      const d = platform.byId.get(m[1]);
      const view = d && sanitizeDevice(platform.deviceView(d, now), session, platform.restrictedRooms, platform.restrictedDeviceIds);
      if (!view) return json(res, 404, { error: 'dispositivo não encontrado' }); // 404 também para não autorizado (não vaza existência)
      if (can(session, 'read:sensitive')) audit(session, 'device.read.sensitive', d.id);
      const visible = new Set(visibleDevices(session, now).map((x) => x.id));
      const deps = platform.deps.filter((e) => (e.from === d.id || e.to === d.id) && visible.has(e.from) && visible.has(e.to));
      const history = platform.history.get(d.id).slice(-120);
      const incidents = platform.incidents.incidents.filter((i) => i.deviceIds.includes(d.id)).slice(-10).map((i) => sanitizeIncident(i, session, platform.restrictedDeviceIds));
      const events = platform.events.filter((e) => e.deviceId === d.id).slice(-30);
      return json(res, 200, { device: view, metrics: TYPES[d.type].metrics, history, deps, incidents, events, trend: d.id === 'UPS-02' ? platform.upsTrend() : null, staleAfterMs: TYPES[d.type].intervalMs * STALE_FACTOR });
    }

    if ((m = p.match(/^\/api\/devices\/([\w-]+)\/video$/))) {
      if (!need('read:video')) return;
      const d = platform.byId.get(m[1]);
      if (!d || d.type !== 'camera') return json(res, 404, { error: 'câmera não encontrada' });
      audit(session, 'video.view', d.id);
      const v = platform.deviceView(d, now);
      return json(res, 200, { deviceId: d.id, streamAvailable: false, reason: 'Nenhuma integração de VMS homologada: exibindo quadro SINTÉTICO.', signal: v.status === 'ok' || v.status === 'degraded' ? (v.values.videoOk ? 'ok' : 'sem-video') : 'sem-dados' });
    }

    if ((m = p.match(/^\/api\/devices\/([\w-]+)\/maintenance$/)) && method === 'POST') {
      if (!need('device:maintenance')) return;
      const body = await readJson(req);
      const r = platform.setMaintenance(m[1], !!body?.on, body?.note, session.user, now);
      audit(session, body?.on ? 'maintenance.start' : 'maintenance.end', m[1]);
      return r.error ? json(res, r.code, r) : json(res, 200, r);
    }

    if (p === '/api/dependencies') {
      const visible = new Set(visibleDevices(session, now).map((x) => x.id));
      return json(res, 200, platform.deps.filter((e) => visible.has(e.from) && visible.has(e.to)));
    }

    if (p === '/api/incidents') {
      const st = url.searchParams.get('status');
      let list = platform.incidents.incidents.slice().reverse();
      if (st === 'active') list = list.filter((i) => i.status !== 'resolvido'); else if (st) list = list.filter((i) => i.status === st);
      return json(res, 200, list.slice(0, 200).map((i) => sanitizeIncident(i, session, platform.restrictedDeviceIds)));
    }

    if ((m = p.match(/^\/api\/incidents\/([\w-]+)\/(ack|resolve)$/)) && method === 'POST') {
      const body = await readJson(req);
      if (m[2] === 'ack') {
        if (!need('incident:ack')) return;
        const r = platform.incidents.acknowledge(m[1], session.user, now);
        if (!r.error) { audit(session, 'incident.ack', m[1]); store.saveIncidents(platform.incidents.incidents); platform.broadcast('update', now); }
        return r.error ? json(res, r.code, r) : json(res, 200, r.incident);
      }
      if (!need('incident:resolve')) return;
      const note = String(body?.note || '').trim().slice(0, 1000);
      if (note.length < 5) return json(res, 400, { error: 'registre a resolução/evidência (mín. 5 caracteres)' });
      const r = platform.incidents.resolve(m[1], session.user, note, now);
      if (!r.error) { audit(session, 'incident.resolve', m[1]); store.saveIncidents(platform.incidents.incidents); platform.broadcast('update', now); }
      return r.error ? json(res, r.code, r) : json(res, 200, r.incident);
    }

    if (p === '/api/events') {
      const limit = Math.min(500, Number(url.searchParams.get('limit')) || 100);
      const cat = url.searchParams.get('category');
      const visibleIds = new Set(visibleDevices(session, now).map((x) => x.id));
      const hide = !can(session, 'read:restricted');
      const list = platform.events.filter((e) => (!cat || e.category === cat) && (!e.deviceId || visibleIds.has(e.deviceId)))
        .filter((e) => !hide || !e.incidentId || !platform.incidents.get(e.incidentId)?.deviceIds.some((id) => platform.restrictedDeviceIds.has(id)))
        .slice(-limit).reverse()
        .map((e) => (hide ? { ...e, text: redactText(e.text, platform.restrictedDeviceIds) } : e));
      return json(res, 200, list);
    }

    if (p === '/api/metrics/summary') {
      const periods = { '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };
      const periodMs = periods[url.searchParams.get('period')] ?? 3600000;
      const category = CATEGORIES[url.searchParams.get('category')] ? url.searchParams.get('category') : '';
      const severity = ['critical', 'high', 'medium', 'low'].includes(url.searchParams.get('severity')) ? url.searchParams.get('severity') : '';
      return json(res, 200, platform.summary({ periodMs, category, severity }, now));
    }

    if (p === '/api/scenarios') return json(res, 200, { scenarios: Object.values(SCENARIOS), active: [...platform.sim.active].map(([id, v]) => ({ id, ...v })) });
    if ((m = p.match(/^\/api\/scenarios\/([A-E]|all)\/(start|stop)$/)) && method === 'POST') {
      if (!need('scenario:run')) return;
      if (m[2] === 'start' && m[1] === 'all') return json(res, 400, { error: 'inicie um cenário por vez' });
      const r = m[2] === 'start' ? platform.startScenario(m[1], session.user, now) : platform.stopScenario(m[1], session.user, now);
      audit(session, `scenario.${m[2]}`, m[1]);
      platform.cycle(Date.now());
      return r.error ? json(res, r.code, r) : json(res, 200, { ok: true, active: [...platform.sim.active.keys()] });
    }

    if (p === '/api/assistant' && method === 'POST') {
      if (!need('assistant:use')) return;
      const body = await readJson(req);
      const q = String(body?.q || '').slice(0, 500);
      audit(session, 'assistant.query', q.slice(0, 120));
      return json(res, 200, answer(q, session, platform, now));
    }

    if (p === '/api/reports/incidents') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const since = url.searchParams.get('period') === '7d' ? now - 7 * 86400000 : start.getTime();
      audit(session, 'report.download', url.searchParams.get('period') || 'today');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="sentinel-relatorio-${new Date(now).toISOString().slice(0, 10)}.md"` });
      return res.end(incidentReport(platform, session, since, now));
    }

    if (p === '/api/connectors') return json(res, 200, CONNECTORS.map((c) => ({ ...c, runtimeStatus: platform.connectorStatus(c.id, now), stats: platform.connectorStats[c.id] ?? null })));

    if (p === '/api/admin/audit') { if (!need('admin:audit')) return; return json(res, 200, auditLog.slice(-300).reverse()); }
    if (p === '/api/admin/config' && method === 'GET') { if (!need('admin:config')) return; return json(res, 200, platform.config); }
    if (p === '/api/admin/config' && method === 'PUT') {
      if (!need('admin:config')) return;
      const body = await readJson(req);
      const days = Number(body?.retentionDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) return json(res, 400, { error: 'retentionDays deve ser inteiro entre 1 e 3650' });
      platform.config.retentionDays = days;
      store.saveConfig(platform.config);
      const kept = store.prune(days);
      audit(session, 'config.update', 'retentionDays', { value: days });
      return json(res, 200, { ...platform.config, eventsKept: kept });
    }

    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\n\n`);
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('snapshot', snapshot(session, Date.now()));
      let last = 0;
      const unsub = platform.subscribe((kind, payload) => {
        if (!sessions.get(session.sid)) return res.end();
        if (kind === 'notify') {
          if (!can(session, 'read:restricted')) {
            const inc = platform.incidents.get(payload.incidentId);
            if (platform.restrictedDeviceIds.has(payload.deviceId) || inc?.deviceIds.some((id) => platform.restrictedDeviceIds.has(id))) return send('notify', { level: payload.level, text: 'Nova ocorrência envolvendo área restrita', ts: payload.ts });
          }
          return send('notify', payload);
        }
        if (Date.now() - last < 900) return; // no máximo ~1 atualização/s por cliente
        last = Date.now();
        send('update', snapshot(session, Date.now()));
      });
      req.on('close', unsub);
      return;
    }

    return json(res, 404, { error: 'rota inexistente' });
  }

  function visibleDevices(session, now) {
    return platform.devices.map((d) => sanitizeDevice(platform.deviceView(d, now), session, platform.restrictedRooms, platform.restrictedDeviceIds)).filter(Boolean);
  }

  function snapshot(session, now) {
    const devices = visibleDevices(session, now).map((d) => ({ id: d.id, status: d.status, reasons: d.reasons, impactedBy: d.impactedBy, ageMs: d.ageMs, maintenance: !!d.maintenance, values: d.values }));
    const incidents = platform.incidents.active().map((i) => sanitizeIncident(i, session, platform.restrictedDeviceIds));
    const k = platform.kpis(now);
    if (!can(session, 'read:restricted')) {
      // KPIs agregados não revelam a contagem de ativos ocultos
      const c = { ok: 0, degraded: 0, critical: 0, offline: 0, unknown: 0, maintenance: 0 };
      devices.forEach((d) => (c[d.status] += 1));
      Object.assign(k, c, { devices: devices.length, noComm: c.offline + c.unknown });
    }
    return { now, kpis: k, devices, incidents, scenarios: k.scenarios };
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
    server.listen(port, '127.0.0.1', () => resolve({ server, platform, port: server.address().port, close: () => { clearInterval(timer); store.flush(platform.incidents.incidents); return new Promise((r) => server.close(r)); } }));
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
    req.on('data', (c) => { size += c.length; if (size > max) { req.destroy(); reject(new Error('payload grande demais')); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch { resolve(null); } });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// execução direta
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8730;
  createServer({ port }).then(({ port: p, close }) => {
    console.log(`\n  SENTINEL 3D — MODO DEMONSTRAÇÃO (dados simulados)\n  http://127.0.0.1:${p}\n`);
    const stop = () => close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  });
}
