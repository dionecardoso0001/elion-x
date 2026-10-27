// Núcleo da API, independente de transporte: roda no servidor Node (server.mjs) e, na versão
// autônoma, dentro do navegador (public/js/local/backend.mjs). Uma única fonte de verdade para
// rotas, validação e autorização — nenhuma regra é duplicada entre os dois modos.

import { ROLES, can, sanitizeDevice, sanitizeIncident, redactText } from '../security/auth.mjs';
import { answer, incidentReport } from '../engine/assistant.mjs';
import { SCENARIOS } from '../engine/simulator.mjs';
import { CONNECTORS } from '../domain/connectors.mjs';
import { TYPES, CATEGORIES, STATUSES, EDGE_LABELS } from '../domain/catalog.mjs';
import { STALE_FACTOR } from '../engine/rules.mjs';

const ok = (body, status = 200) => ({ status, body });
const err = (status, error) => ({ status, body: { error } });

/**
 * @param platform  instância de Platform
 * @param sessions  instância de Sessions
 * @param store     Store (Node) ou null (navegador: sem persistência em disco)
 * @param audit     (session, action, target, extra) => void
 * @param auditLog  array com as entradas mais recentes
 * @param demoAuth  permite escolher perfil de demonstração
 * @param brandLogo () => url | null
 * @param uptimeS   () => segundos de execução
 */
export function createApi({ platform, sessions, store = null, audit, auditLog, demoAuth = true, brandLogo = () => null, uptimeS = () => 0 }) {
  const visibleDevices = (session, now) => platform.devices
    .map((d) => sanitizeDevice(platform.deviceView(d, now), session, platform.restrictedRooms, platform.restrictedDeviceIds))
    .filter(Boolean);

  function snapshot(session, now) {
    const devices = visibleDevices(session, now).map((d) => ({ id: d.id, status: d.status, reasons: d.reasons, impactedBy: d.impactedBy, ageMs: d.ageMs, maintenance: !!d.maintenance, values: d.values }));
    const incidents = platform.incidents.active().map((i) => sanitizeIncident(i, session, platform.restrictedDeviceIds));
    const k = platform.kpis(now);
    if (!can(session, 'read:restricted')) {
      // KPIs agregados não revelam a contagem de ativos ocultos nem medições de áreas restritas
      const c = { ok: 0, degraded: 0, critical: 0, offline: 0, unknown: 0, maintenance: 0 };
      devices.forEach((d) => (c[d.status] += 1));
      Object.assign(k, c, { devices: devices.length, noComm: c.offline + c.unknown, kw: null, kwhToday: null });
    }
    return { now, kpis: k, devices, incidents, scenarios: k.scenarios };
  }

  /** Assina o fluxo em tempo real; send(event, data). Retorna a função de cancelamento. */
  function subscribe(session, send) {
    send('snapshot', snapshot(session, Date.now()));
    let last = 0;
    const unsub = platform.subscribe((kind, payload) => {
      if (!sessions.get(session.sid)) return unsub();
      if (kind === 'notify') {
        if (!can(session, 'read:restricted')) {
          const inc = platform.incidents.get(payload.incidentId);
          if (platform.restrictedDeviceIds.has(payload.deviceId) || inc?.deviceIds.some((id) => platform.restrictedDeviceIds.has(id))) {
            return send('notify', { level: payload.level, text: 'Nova ocorrência envolvendo área restrita', ts: payload.ts });
          }
        }
        return send('notify', payload);
      }
      if (Date.now() - last < 900) return; // no máximo ~1 atualização/s por cliente
      last = Date.now();
      send('update', snapshot(session, Date.now()));
    });
    return unsub;
  }

  /**
   * @param req { method, path, query: URLSearchParams, body, session }
   * @returns { status, body } | { status, text, contentType, filename } | { ..., newSession }
   */
  function handle({ method, path: p, query, body, session }) {
    const now = Date.now();
    const q = (k) => query.get(k);

    if (p === '/api/health') return ok({ status: 'ok', uptimeS: Math.round(uptimeS()), devices: platform.devices.length, demo: true });
    if (p === '/api/session' && method === 'GET') return ok({ authenticated: !!session, role: session?.role ?? null });
    if (p === '/api/session' && method === 'POST') {
      if (!demoAuth) return err(403, 'autenticação de demonstração desabilitada — use o IdP corporativo');
      const s = sessions.create(body?.role);
      if (!s) return err(400, 'perfil inválido');
      if (session) sessions.destroy(session.sid);
      audit(s, 'session.create', s.role);
      return { ...ok({ user: s.user, role: s.role, perms: ROLES[s.role].perms }), newSession: s };
    }

    if (!session) return err(401, 'sessão necessária');
    const need = (perm) => {
      if (can(session, perm)) return null;
      audit(session, 'denied', p, { perm });
      return err(403, `permissão necessária: ${perm}`);
    };
    let m;

    if (p === '/api/me') return ok({ user: session.user, role: session.role, roleLabel: ROLES[session.role].label, perms: ROLES[session.role].perms });
    if (p === '/api/meta') return ok({ types: TYPES, categories: CATEGORIES, statuses: STATUSES, edgeLabels: EDGE_LABELS, staleFactor: STALE_FACTOR, roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label])) });
    if (p === '/api/agencies') return ok(platform.twin.agencies.map(({ id, name, city, timezone, demo, disclaimer }) => ({ id, name, city, timezone, demo, disclaimer })));
    if ((m = p.match(/^\/api\/agencies\/([\w-]+)\/layout$/))) {
      const ag = platform.twin.agencies.find((a) => a.id === m[1]);
      if (!ag || !session.agencies.includes(ag.id)) return err(404, 'agência não encontrada');
      return ok(ag);
    }
    // logotipo oficial: só é usado se um ativo AUTORIZADO for fornecido
    if (p === '/api/brand') return ok({ logo: brandLogo() });
    if (p === '/api/state') return ok(snapshot(session, now));

    if (p === '/api/devices') {
      return ok(visibleDevices(session, now).filter((d) => (!q('category') || d.category === q('category')) && (!q('status') || d.status === q('status'))));
    }
    if ((m = p.match(/^\/api\/devices\/([\w-]+)$/)) && method === 'GET') {
      const d = platform.byId.get(m[1]);
      const view = d && sanitizeDevice(platform.deviceView(d, now), session, platform.restrictedRooms, platform.restrictedDeviceIds);
      if (!view) return err(404, 'dispositivo não encontrado'); // 404 também para não autorizado (não vaza existência)
      if (can(session, 'read:sensitive')) audit(session, 'device.read.sensitive', d.id);
      const visible = new Set(visibleDevices(session, now).map((x) => x.id));
      return ok({
        device: view, metrics: TYPES[d.type].metrics,
        history: platform.history.get(d.id).slice(-120),
        deps: platform.deps.filter((e) => (e.from === d.id || e.to === d.id) && visible.has(e.from) && visible.has(e.to)),
        incidents: platform.incidents.incidents.filter((i) => i.deviceIds.includes(d.id)).slice(-10).map((i) => sanitizeIncident(i, session, platform.restrictedDeviceIds)),
        events: platform.events.filter((e) => e.deviceId === d.id).slice(-30),
        trend: d.id === 'UPS-02' ? platform.upsTrend() : null,
        staleAfterMs: TYPES[d.type].intervalMs * STALE_FACTOR,
      });
    }
    if ((m = p.match(/^\/api\/devices\/([\w-]+)\/video$/))) {
      const denied = need('read:video'); if (denied) return denied;
      const d = platform.byId.get(m[1]);
      if (!d || d.type !== 'camera') return err(404, 'câmera não encontrada');
      audit(session, 'video.view', d.id);
      const v = platform.deviceView(d, now);
      return ok({ deviceId: d.id, streamAvailable: false, reason: 'Nenhuma integração de VMS homologada: exibindo quadro SINTÉTICO.', signal: v.status === 'ok' || v.status === 'degraded' ? (v.values.videoOk ? 'ok' : 'sem-video') : 'sem-dados' });
    }
    if ((m = p.match(/^\/api\/devices\/([\w-]+)\/maintenance$/)) && method === 'POST') {
      const denied = need('device:maintenance'); if (denied) return denied;
      const r = platform.setMaintenance(m[1], !!body?.on, body?.note, session.user, now);
      audit(session, body?.on ? 'maintenance.start' : 'maintenance.end', m[1]);
      return r.error ? err(r.code, r.error) : ok(r);
    }
    if (p === '/api/dependencies') {
      const visible = new Set(visibleDevices(session, now).map((x) => x.id));
      return ok(platform.deps.filter((e) => visible.has(e.from) && visible.has(e.to)));
    }

    if (p === '/api/incidents') {
      const st = q('status');
      let list = platform.incidents.incidents.slice().reverse();
      if (st === 'active') list = list.filter((i) => i.status !== 'resolvido'); else if (st) list = list.filter((i) => i.status === st);
      return ok(list.slice(0, 200).map((i) => sanitizeIncident(i, session, platform.restrictedDeviceIds)));
    }
    if ((m = p.match(/^\/api\/incidents\/([\w-]+)\/(ack|resolve)$/)) && method === 'POST') {
      if (m[2] === 'ack') {
        const denied = need('incident:ack'); if (denied) return denied;
        const r = platform.incidents.acknowledge(m[1], session.user, now);
        if (r.error) return err(r.code, r.error);
        audit(session, 'incident.ack', m[1]); store?.saveIncidents(platform.incidents.incidents); platform.broadcast('update', now);
        return ok(r.incident);
      }
      const denied = need('incident:resolve'); if (denied) return denied;
      const note = String(body?.note || '').trim().slice(0, 1000);
      if (note.length < 5) return err(400, 'registre a resolução/evidência (mín. 5 caracteres)');
      const r = platform.incidents.resolve(m[1], session.user, note, now);
      if (r.error) return err(r.code, r.error);
      audit(session, 'incident.resolve', m[1]); store?.saveIncidents(platform.incidents.incidents); platform.broadcast('update', now);
      return ok(r.incident);
    }

    if (p === '/api/events') {
      const limit = Math.min(500, Number(q('limit')) || 100);
      const cat = q('category');
      const visibleIds = new Set(visibleDevices(session, now).map((x) => x.id));
      const hide = !can(session, 'read:restricted');
      return ok(platform.events.filter((e) => (!cat || e.category === cat) && (!e.deviceId || visibleIds.has(e.deviceId)))
        .filter((e) => !hide || !e.incidentId || !platform.incidents.get(e.incidentId)?.deviceIds.some((id) => platform.restrictedDeviceIds.has(id)))
        .slice(-limit).reverse()
        .map((e) => (hide ? { ...e, text: redactText(e.text, platform.restrictedDeviceIds) } : e)));
    }

    if (p === '/api/metrics/summary') {
      const periods = { '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };
      const periodMs = periods[q('period')] ?? 3600000;
      const category = CATEGORIES[q('category')] ? q('category') : '';
      const severity = ['critical', 'high', 'medium', 'low'].includes(q('severity')) ? q('severity') : '';
      const sum = platform.summary({ periodMs, category, severity }, now);
      if (!can(session, 'read:restricted')) {
        // energia (MTR-01), banda WAN (RTR-01) e nobreaks ficam em área restrita: não chegam ao observador
        sum.series = sum.series.map((x) => ({ ...x, kw: null, wanMbps: null }));
        sum.upsTrend = null;
        sum.restricted = ['kw', 'wanMbps', 'upsTrend'];
      }
      return ok(sum);
    }

    if (p === '/api/scenarios') return ok({ scenarios: Object.values(SCENARIOS), active: [...platform.sim.active].map(([id, v]) => ({ id, ...v })) });
    if ((m = p.match(/^\/api\/scenarios\/([A-Z]|all)\/(start|stop)$/)) && method === 'POST') {
      const denied = need('scenario:run'); if (denied) return denied;
      if (m[2] === 'start' && m[1] === 'all') return err(400, 'inicie um cenário por vez');
      const r = m[2] === 'start' ? platform.startScenario(m[1], session.user, now) : platform.stopScenario(m[1], session.user, now);
      audit(session, `scenario.${m[2]}`, m[1]);
      platform.cycle(Date.now());
      return r.error ? err(r.code, r.error) : ok({ ok: true, active: [...platform.sim.active.keys()] });
    }

    if (p === '/api/assistant' && method === 'POST') {
      const denied = need('assistant:use'); if (denied) return denied;
      const question = String(body?.q || '').slice(0, 500);
      audit(session, 'assistant.query', question.slice(0, 120));
      return ok(answer(question, session, platform, now));
    }

    if (p === '/api/reports/incidents') {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      const since = q('period') === '7d' ? now - 7 * 86400000 : start.getTime();
      audit(session, 'report.download', q('period') || 'today');
      return { status: 200, text: incidentReport(platform, session, since, now), contentType: 'text/markdown; charset=utf-8', filename: `sentinel-relatorio-${new Date(now).toISOString().slice(0, 10)}.md` };
    }

    if (p === '/api/connectors') return ok(CONNECTORS.map((c) => ({ ...c, runtimeStatus: platform.connectorStatus(c.id, now), stats: platform.connectorStats[c.id] ?? null })));

    if (p === '/api/admin/audit') { const denied = need('admin:audit'); if (denied) return denied; return ok(auditLog.slice(-300).reverse()); }
    if (p === '/api/admin/config' && method === 'GET') { const denied = need('admin:config'); if (denied) return denied; return ok(platform.config); }
    if (p === '/api/admin/config' && method === 'PUT') {
      const denied = need('admin:config'); if (denied) return denied;
      const days = Number(body?.retentionDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) return err(400, 'retentionDays deve ser inteiro entre 1 e 3650');
      platform.config.retentionDays = days;
      store?.saveConfig(platform.config);
      const kept = store ? store.prune(days) : platform.events.length;
      audit(session, 'config.update', 'retentionDays', { value: days });
      return ok({ ...platform.config, eventsKept: kept });
    }

    return err(404, 'rota inexistente');
  }

  return { handle, snapshot, subscribe, visibleDevices };
}
