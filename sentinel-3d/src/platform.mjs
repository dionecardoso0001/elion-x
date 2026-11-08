// Orquestrador do pipeline (docs/ARQUITETURA.md §4):
// conector → validação → regras → anomalias → correlação → diagnóstico → incidente → estado 3D → SSE

import { buildTwin } from './domain/twin.mjs';
import { TYPES, CATEGORIES, STATUSES } from './domain/catalog.mjs';
import { CONNECTORS } from './domain/connectors.mjs';
import { validateReading } from './engine/ingest.mjs';
import { computeStates } from './engine/rules.mjs';
import { detectAnomalies, projectCrossing } from './engine/analytics.mjs';
import { correlate } from './engine/correlation.mjs';
import { diagnose } from './engine/diagnostics.mjs';
import { IncidentManager, incidentMetrics } from './engine/incidents.mjs';
import { Simulator, SCENARIOS, mulberry32 } from './engine/simulator.mjs';

const HISTORY_MAX = 300;
const EVENTS_MAX = 5000;
const SERIES_EVERY_MS = 10_000;
const EVENT_SEVERITY = { critical: 'critical', offline: 'high', degraded: 'medium', unknown: 'medium', ok: 'info', maintenance: 'info' };

export class Platform {
  /**
   * mode 'demo'      → simulador + séries/histórico sintéticos rotulados (padrão).
   * mode 'integracao'→ SEM simulador e SEM dado sintético: só telemetria de conectores (POST /api/ingest).
   *                    Um dispositivo que nunca reportou fica "sem dados confiáveis", nunca "operacional".
   */
  constructor({ store = null, seed = 42, now = Date.now(), ingestToken = '', mode = 'demo' } = {}) {
    if (!['demo', 'integracao'].includes(mode)) throw new Error(`modo inválido: ${mode}`);
    this.mode = mode;
    this.simulate = mode === 'demo';
    this.store = store;
    this.twin = buildTwin();
    this.devices = this.twin.devices;
    this.deps = this.twin.dependencies;
    this.agency = this.twin.agencies[0];
    this.byId = new Map(this.devices.map((d) => [d.id, d]));
    this.roomsById = new Map(this.agency.rooms.map((r) => [r.id, r]));
    this.restrictedRooms = new Set(this.agency.rooms.filter((r) => r.restricted).map((r) => r.id));
    this.restrictedDeviceIds = new Set(this.devices.filter((d) => this.restrictedRooms.has(d.room)).map((d) => d.id));
    this.history = new Map(this.devices.map((d) => [d.id, []]));
    this.latest = new Map();
    this.anomalies = new Map();
    this.flags = new Map();
    this.firstSignal = new Map();
    this.states = new Map();
    this.groups = [];
    this.series = [];
    this.lastSeriesAt = 0;
    this.subscribers = new Set();
    this.ingestEnabled = !!ingestToken;
    this.connectorStats = { simulador: { received: 0, rejected: 0, lastAt: null }, 'ingest-api': { received: 0, rejected: 0, lastAt: null, lastError: null } };

    this.events = store ? store.loadEvents() : [];
    this.config = store ? store.loadConfig() : { retentionDays: 30 };
    const saved = store ? store.loadIncidents() : [];
    this.incidents = new IncidentManager({ incidents: saved, onEvent: (type, inc) => this.onIncidentEvent(type, inc) });
    if (!saved.length && this.simulate) this.seedHistoryIncidents(now);

    this.sim = new Simulator({ devices: this.devices, deps: this.deps, seed });
    if (this.simulate) this.backfill(now);
    else for (const d of this.devices) d.source = { connector: 'ingest-api', protocol: 'HTTPS POST /api/ingest (gateway)', note: 'Aguardando telemetria do gateway de integração' };
    this.cycle(now);
  }

  // ---------- pipeline ----------

  ingest(raw, connector, now) {
    const res = validateReading(raw, this.byId, now);
    const stats = this.connectorStats[connector];
    if (!res.ok) { if (stats) { stats.rejected += 1; stats.lastError = res.error; } return res; }
    const r = res.reading;
    const dev = this.byId.get(r.deviceId);
    const hist = this.history.get(r.deviceId);
    this.anomalies.set(r.deviceId, detectAnomalies(dev.type, hist, r.values));
    hist.push({ t: r.sourceTs, values: r.values });
    if (hist.length > HISTORY_MAX) hist.shift();
    r.connector = connector; // rastreabilidade: de onde veio cada leitura
    this.latest.set(r.deviceId, r);
    if (stats) { stats.received += 1; stats.lastAt = now; }
    return res;
  }

  cycle(now = Date.now()) {
    if (this.simulate) for (const raw of this.sim.tick(now)) this.ingest(raw, 'simulador', now);
    this.recompute(now);
  }

  recompute(now) {
    const prev = this.states;
    this.states = computeStates({ devices: this.devices, deps: this.deps, latest: this.latest, now, flags: this.flags, anomalies: this.anomalies });

    for (const [id, s] of this.states) {
      const before = prev.get(id)?.status;
      if (s.status === 'ok' || s.status === 'maintenance') this.firstSignal.delete(id);
      else if (!this.firstSignal.has(id)) this.firstSignal.set(id, s.status === 'offline' || s.status === 'unknown' ? (s.lastSeen ?? now) : (this.latest.get(id)?.sourceTs ?? now));
      if (before && before !== s.status) {
        const d = this.byId.get(id);
        this.pushEvent({ ts: now, type: 'state.changed', severity: EVENT_SEVERITY[s.status], category: TYPES[d.type].category, deviceId: id,
          text: `${id}: ${STATUSES[before].label} → ${STATUSES[s.status].label}${s.reasons[0] ? ' — ' + s.reasons[0].text : ''}`, from: before, to: s.status });
      }
    }

    this.groups = correlate({ devices: this.devices, deps: this.deps, states: this.states });
    const ctx = { byId: this.byId, states: this.states, latest: this.latest, now, roomsById: this.roomsById, devices: this.devices, deps: this.deps };
    const diagnoses = new Map(this.groups.map((g) => [g.key, diagnose(g, ctx)]));
    const changed = this.incidents.reconcile(this.groups, diagnoses, now, { firstSignal: this.firstSignal, agencyId: this.agency.id, synthetic: this.simulate });
    if (changed.length) this.store?.saveIncidents(this.incidents.incidents);

    if (now - this.lastSeriesAt >= SERIES_EVERY_MS) { this.series.push(this.sample(now)); this.lastSeriesAt = now; if (this.series.length > 3000) this.series.shift(); }
    this.broadcast('update', now);
  }

  sample(now, synthetic = false) {
    const counts = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
    const byCategory = {};
    for (const d of this.devices) {
      const s = this.states.get(d.id)?.status || 'unknown';
      counts[s] += 1;
      const c = TYPES[d.type].category;
      byCategory[c] ??= { total: 0, ok: 0 };
      byCategory[c].total += 1;
      if (s === 'ok') byCategory[c].ok += 1;
    }
    const meter = this.freshValues('MTR-01', now);
    const rtr = this.freshValues('RTR-01', now);
    const monitored = this.devices.length - counts.maintenance;
    return { t: now, counts, availabilityPct: monitored ? (counts.ok / monitored) * 100 : null, kw: meter?.kW ?? null, wanMbps: rtr?.bandwidthMbps ?? null, byCategory, synthetic };
  }

  freshValues(id, now) {
    const s = this.states.get(id);
    if (!s || ['offline', 'unknown'].includes(s.status)) return null; // não reaproveita dado antigo como atual
    return this.latest.get(id)?.values ?? null;
  }

  // ---------- eventos e notificações ----------

  pushEvent(ev) {
    const e = { id: `EV-${ev.ts}-${Math.floor(Math.random() * 1e6)}`, synthetic: this.simulate, ...ev };
    this.events.push(e);
    if (this.events.length > EVENTS_MAX) this.events.shift();
    this.store?.appendEvent(e);
    return e;
  }

  onIncidentEvent(type, inc) {
    const root = this.byId.get(inc.rootDeviceId);
    const e = this.pushEvent({ ts: inc.updatedAt, type, severity: inc.severity, category: root ? TYPES[root.type].category : 'geral', deviceId: inc.rootDeviceId, incidentId: inc.id, text: `${inc.id}: ${type.split('.')[1]} — ${inc.title}` });
    if (['incident.created', 'incident.escalated', 'incident.reopened'].includes(type)) this.notify({ level: inc.severity, incidentId: inc.id, deviceId: inc.rootDeviceId, text: e.text, ts: e.ts });
  }

  notify(n) { for (const sub of this.subscribers) sub('notify', n); }
  broadcast(kind, now) { for (const sub of this.subscribers) sub(kind, now); }
  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); }

  // ---------- ações de operador ----------

  setMaintenance(id, on, note, user, now = Date.now()) {
    if (!this.byId.has(id)) return { error: 'não encontrado', code: 404 };
    if (on) this.flags.set(id, { maintenance: true, note: String(note || '').slice(0, 200), by: user, since: now });
    else this.flags.delete(id);
    this.pushEvent({ ts: now, type: on ? 'maintenance.start' : 'maintenance.end', severity: 'info', category: TYPES[this.byId.get(id).type].category, deviceId: id, text: `${id}: manutenção ${on ? 'iniciada' : 'encerrada'} por ${user}` });
    this.recompute(now);
    return { ok: true };
  }

  startScenario(id, user, now = Date.now()) {
    if (!this.simulate) return { error: 'simulador desativado no modo integração', code: 409 };
    if (!this.sim.start(id, now)) return { error: 'cenário inexistente', code: 404 };
    this.pushEvent({ ts: now, type: 'scenario.start', severity: 'info', category: 'simulacao', text: `MODO DEMONSTRAÇÃO — cenário ${id} (${SCENARIOS[id].label}) iniciado por ${user}` });
    return { ok: true };
  }

  stopScenario(id, user, now = Date.now()) {
    if (!this.simulate) return { error: 'simulador desativado no modo integração', code: 409 };
    if (id === 'all') this.sim.reset(); else this.sim.stop(id);
    this.pushEvent({ ts: now, type: 'scenario.stop', severity: 'info', category: 'simulacao', text: `MODO DEMONSTRAÇÃO — ${id === 'all' ? 'todos os cenários encerrados' : `cenário ${id} encerrado`} por ${user}` });
    return { ok: true };
  }

  // ---------- consultas ----------

  deviceView(d, now = Date.now()) {
    const s = this.states.get(d.id);
    const r = this.latest.get(d.id);
    return {
      ...d, category: TYPES[d.type].category, typeLabel: TYPES[d.type].label,
      status: s?.status ?? 'unknown', reasons: s?.reasons ?? [], impactedBy: s?.impactedBy ?? [],
      lastSeen: s?.lastSeen ?? null, ageMs: r ? now - r.ingestTs : null,
      values: r?.values ?? {}, sourceTs: r?.sourceTs ?? null, quality: r?.quality ?? null,
      lastConnector: r?.connector ?? null,
      maintenance: this.flags.get(d.id) ?? null,
    };
  }

  kpis(now = Date.now()) {
    const c = { ok: 0, degraded: 0, critical: 0, offline: 0, unknown: 0, maintenance: 0 };
    for (const s of this.states.values()) c[s.status] += 1;
    const meter = this.freshValues('MTR-01', now);
    const connectorsUp = CONNECTORS.filter((x) => this.connectorStatus(x.id, now) === 'ativo').length;
    return {
      agencies: this.twin.agencies.length, devices: this.devices.length, ...c,
      noComm: c.offline + c.unknown,
      openIncidents: this.incidents.active().length,
      kw: meter?.kW ?? null, kwhToday: meter?.kWhToday ?? null,
      connectors: { up: connectorsUp, total: CONNECTORS.length },
      lastUpdate: now, scenarios: [...this.sim.active.keys()], mode: this.mode,
    };
  }

  connectorStatus(id, now) {
    if (id === 'simulador') return !this.simulate ? 'desativado' : now - (this.connectorStats.simulador.lastAt ?? 0) < 5000 ? 'ativo' : 'inativo';
    if (id === 'ingest-api') return this.ingestEnabled ? (now - (this.connectorStats['ingest-api'].lastAt ?? 0) < 60000 ? 'ativo' : 'aguardando dados') : 'desabilitado';
    return 'não conectado';
  }

  upsTrend() {
    if (this.simulate) {
      const series = this.sim.healthSeries;
      return { deviceId: 'UPS-02', metric: 'batteryHealthPct', synthetic: true, series, analysis: projectCrossing(series, 80, 'down') };
    }
    // integração: somente leituras reais recebidas; sem dados suficientes, a análise diz isso
    const series = this.history.get('UPS-02').map((h) => ({ t: h.t, v: h.values.batteryHealthPct })).filter((p) => typeof p.v === 'number');
    return { deviceId: 'UPS-02', metric: 'batteryHealthPct', synthetic: false, series, analysis: projectCrossing(series, 80, 'down') ?? { projection: null, reason: `apenas ${series.length} leitura(s) real(is); mínimo 10` } };
  }

  summary({ periodMs = 3600000, category = '', severity = '' } = {}, now = Date.now()) {
    const since = now - periodMs;
    const catOf = (id) => (this.byId.get(id) ? TYPES[this.byId.get(id).type].category : null);
    const sevOk = (s) => !severity || s === severity;
    const series = this.series.filter((p) => p.t >= since).map((p) => ({
      t: p.t, synthetic: p.synthetic,
      availabilityPct: category ? (p.byCategory[category]?.total ? (p.byCategory[category].ok / p.byCategory[category].total) * 100 : null) : p.availabilityPct,
      kw: p.kw, wanMbps: p.wanMbps,
    }));
    const events = this.events.filter((e) => e.ts >= since && (!category || e.category === category) && sevOk(e.severity));
    const eventsByCategory = {};
    for (const e of events) eventsByCategory[e.category] = (eventsByCategory[e.category] || 0) + 1;
    const incs = this.incidents.incidents.filter((i) => i.createdAt >= since && (!category || catOf(i.rootDeviceId) === category) && sevOk(i.severity));
    const bucketMs = periodMs <= 3600000 ? 300000 : periodMs <= 86400000 ? 3600000 : 86400000;
    const incidentsOverTime = {};
    for (const i of incs) { const b = Math.floor(i.createdAt / bucketMs) * bucketMs; incidentsOverTime[b] = (incidentsOverTime[b] || 0) + 1; }
    const bySeverity = {};
    for (const i of incs) bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    const recurrence = {};
    for (const i of incs) for (const id of [i.rootDeviceId]) recurrence[id] = (recurrence[id] || 0) + 1 + (i.recurrences || 0);
    const recurrent = Object.entries(recurrence).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, n }));
    return {
      period: { since, until: now, periodMs, bucketMs }, filters: { category, severity },
      series, seriesStart: this.series[0]?.t ?? null,
      eventsByCategory, incidentsOverTime: Object.entries(incidentsOverTime).map(([t, n]) => ({ t: +t, n })).sort((a, b) => a.t - b.t),
      bySeverity, recurrent, incidentsByAgency: { [this.agency.id]: incs.length },
      metrics: incidentMetrics(incs), incidentCount: incs.length,
      upsTrend: this.upsTrend(),
      categories: CATEGORIES,
    };
  }

  // ---------- dados sintéticos iniciais (rotulados) ----------

  backfill(now) {
    // 60 min de histórico por dispositivo (1 amostra/min) para linha de base e sparklines
    for (let t = now - 60 * 60000; t < now; t += 60000) {
      for (const d of this.devices) this.history.get(d.id).push({ t, values: this.sim.normalValues(d, t), synthetic: 'backfill' });
    }
    // 6 h de série agregada
    const r = mulberry32(99);
    const meter = this.byId.get('MTR-01');
    const rtr = this.byId.get('RTR-01');
    for (let t = now - 6 * 3600000; t < now; t += 60000) {
      const deg = r() < 0.08 ? 1 : 0;
      const total = this.devices.length;
      this.series.push({
        t, synthetic: true, counts: { ok: total - deg, degraded: deg },
        availabilityPct: ((total - deg) / total) * 100,
        kw: this.sim.normalValues(meter, t).kW, wanMbps: this.sim.normalValues(rtr, t).bandwidthMbps,
        byCategory: Object.fromEntries(Object.keys(CATEGORIES).map((c) => { const n = this.devices.filter((d) => TYPES[d.type].category === c).length; return [c, { total: n, ok: n - (deg && c === 'cftv' ? 1 : 0) }]; })),
      });
    }
  }

  seedHistoryIncidents(now) {
    const H = 3600000;
    const items = [
      [6 * 24 * H, 'CAM-012', 'video-loss', 'high', 'Perda de vídeo — CAM-012 (Autoatendimento)', 42, 'Câmera reposicionada e perfil de vídeo reiniciado'],
      [5 * 24 * H, 'ATM-03', 'offline', 'high', 'Sem comunicação — ATM-03', 95, 'Cabo de rede substituído pelo fornecedor'],
      [4 * 24 * H, 'MTR-01', 'anomaly', 'medium', 'Anomalia estatística — consumo do QDG', 20, 'Carga atípica justificada (manutenção predial)'],
      [3 * 24 * H, 'SW-02', 'cascade', 'high', 'Perda de comunicação em SW-02 com 6 dependentes', 30, 'Fonte do switch substituída'],
      [2 * 24 * H + 5 * H, 'CAM-012', 'video-loss', 'high', 'Perda de vídeo — CAM-012 (Autoatendimento)', 25, 'Reincidência: lente limpa e firmware atualizado'],
      [2 * 24 * H, 'TH-01', 'degraded', 'medium', 'Instabilidade — temperatura do CPD acima de 27 °C', 50, 'Filtro do HVAC-01 limpo'],
      [24 * H, 'UPS-02', 'degraded', 'medium', 'Instabilidade — UPS-02 autoteste com alerta de bateria', 180, 'Agendada substituição do banco de baterias'],
      [10 * H, 'CAM-019', 'offline', 'high', 'Sem comunicação — CAM-019', 15, 'Porta PoE reiniciada'],
    ];
    const r = mulberry32(5);
    for (const [ago, dev, kind, severity, title, mttrMin, note] of items) {
      const createdAt = now - ago;
      const firstSignalAt = createdAt - Math.round(20000 + r() * 70000);
      this.incidents.incidents.push({
        id: this.incidents.newId(createdAt), key: `history:${dev}:${createdAt}`, kind, agencyId: this.agency.id,
        title, severity, priority: severity === 'high' ? 'P2' : 'P3', status: 'resolvido', rootDeviceId: dev, deviceIds: [dev],
        firstSignalAt, createdAt, updatedAt: createdAt + mttrMin * 60000, ackAt: createdAt + 120000, ackBy: 'histórico sintético',
        resolvedAt: createdAt + mttrMin * 60000, resolvedBy: 'histórico sintético', resolutionNote: note, escalationLevel: 1,
        alertCount: 1, suppressedDuplicates: 0, synthetic: 'history',
        diagnosis: { engine: 'histórico sintético', title, facts: ['Registro SINTÉTICO criado para demonstrar relatórios e métricas'], hypothesis: '—', confidence: '—', confidenceCriteria: [], recommendations: [], uncertainties: [] },
        timeline: [{ ts: createdAt, type: 'criado', text: 'Histórico sintético de demonstração' }, { ts: createdAt + mttrMin * 60000, type: 'resolvido', text: note }],
      });
    }
  }
}
