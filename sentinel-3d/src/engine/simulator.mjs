// Simulador de telemetria — MODO DEMONSTRAÇÃO. Gera leituras sintéticas no mesmo
// contrato de um conector real; as leituras passam pela validação normal (ingest.mjs).
// Nenhum equipamento físico é contatado.

import { TYPES } from '../domain/catalog.mjs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TIME_ACCELERATION = 30; // descarga do UPS acelerada 30× para a demonstração

export const SCENARIOS = {
  A: {
    id: 'A', label: 'Falha de câmera', target: 'CAM-018',
    description: 'O stream de vídeo da CAM-018 para; a câmera continua respondendo à rede.',
    expected: ['CAM-018 vai para falha crítica (vermelho)', 'Incidente "Perda de vídeo" aberto', 'Diagnóstico com hipótese local (confiança média)'],
  },
  B: {
    id: 'B', label: 'Falha em switch', target: 'SW-03',
    description: 'O SW-03 perde conectividade; as câmeras alimentadas por PoE param de reportar.',
    expected: ['SW-03 desconectado', 'CAM-014/015/016 sem dados confiáveis', 'Um único incidente correlacionado com causa raiz provável SW-03'],
  },
  C: {
    id: 'C', label: 'Problema elétrico', target: 'MTR-01',
    description: `Falta de energia na entrada; UPS-01 e UPS-02 transferem para bateria (descarga acelerada ${TIME_ACCELERATION}×).`,
    expected: ['MTR-01 em falha crítica', 'Nobreaks em bateria com autonomia decrescente', 'Terminais e climatização sem alimentação', 'Alerta de risco operacional'],
  },
  D: {
    id: 'D', label: 'Alarme de incêndio', target: 'SD-04',
    description: 'A central FACP-01 reporta alarme no detector SD-04 (Recepção). Nenhuma atuação física é executada.',
    expected: ['Região da Recepção destacada', 'Incidente P1 com protocolo de escalonamento', 'Nenhum comando enviado'],
  },
  E: {
    id: 'E', label: 'Telemetria desatualizada', target: 'GW-IOT-01',
    description: 'Somente o gateway GW-IOT-01 para de comunicar; sensores atrás dele ficam sem dados.',
    expected: ['GW-IOT-01 desconectado', 'Sensores em "sem dados confiáveis" (roxo), não em falha', 'Últimas leituras preservadas com idade'],
  },
  F: {
    id: 'F', label: 'Estado do mapa conceitual', target: 'CAM-020',
    description: 'Reproduz o mapa de ativos fornecido: câmera da Área Restrita offline e cofre com alimentação do controlador instável.',
    expected: ['CAM-020 desconectada', 'VAULT-01 instável (status lógico)', 'Demais ativos operacionais'],
  },
  G: {
    id: 'G', label: 'Queda do link principal', target: 'RTR-01',
    description: 'O link WAN principal cai; o tráfego migra para o link secundário 4G (latência maior). A redundância mantém a rede.',
    expected: ['RTR-01 desconectado', 'RTR-02 assume a banda com latência maior', 'Firewall e rede interna seguem operacionais (redundância)'],
  },
  H: {
    id: 'H', label: 'Degradação térmica', target: 'HVAC-01',
    description: 'A climatização do Suporte Técnico perde rendimento; temperaturas sobem gradualmente em ~60 s até cruzar limiares.',
    expected: ['HVAC-01 instável (insuflamento quente)', 'TH-01 e servidores aquecendo progressivamente', 'Um incidente térmico com causa raiz provável HVAC-01'],
  },
};
const THERMAL_RAMP_MS = 60_000;

export class Simulator {
  constructor({ devices, deps, seed = 42 }) {
    this.devices = devices;
    this.byId = new Map(devices.map((d) => [d.id, d]));
    this.rng = mulberry32(seed);
    this.nextDue = new Map();
    this.active = new Map(); // id -> { startedAt }
    this.kwhToday = 38.4;
    this.ups = {
      'UPS-01': { battery: 100, fullRuntime: 45, health: 96.1 },
      'UPS-02': { battery: 100, fullRuntime: 38, health: null },
    };
    this.healthSeries = this.buildHealthSeries(Date.now());
    this.ups['UPS-02'].health = this.healthSeries.at(-1).v;
    this.gatewayChildren = deps.filter((e) => e.from === 'GW-IOT-01' && e.type === 'data-path').map((e) => e.to);
    this.sw03Children = deps.filter((e) => e.from === 'SW-03' && e.type === 'poe').map((e) => e.to);
    // canais gravados por NVR = câmeras dos switches que cada um atende
    const poeOf = (sw) => deps.filter((e) => e.from === sw && e.type === 'poe' && e.to.startsWith('CAM-')).length;
    this.nvrChannels = { 'NVR-01': poeOf('SW-01'), 'NVR-02': poeOf('SW-02') + poeOf('SW-03') };
    this.lastTick = null;
  }

  n(mean, sd) { // aproximação normal (soma de uniformes)
    return mean + sd * ((this.rng() + this.rng() + this.rng() + this.rng() - 2) * 1.2247);
  }

  /** Série SINTÉTICA de saúde da bateria do UPS-02 (60 dias) para demonstrar análise de tendência. */
  buildHealthSeries(now) {
    const r = mulberry32(7);
    return Array.from({ length: 60 }, (_, i) => ({
      t: now - (59 - i) * 86400000,
      v: Math.round((92 - 0.17 * i + (r() - 0.5) * 0.5) * 10) / 10,
    }));
  }

  silenced() {
    const s = new Set();
    if (this.active.has('B')) { s.add('SW-03'); this.sw03Children.forEach((c) => s.add(c)); }
    if (this.active.has('C')) ['ATM-01', 'ATM-02', 'ATM-03', 'ATM-04', 'TOT-01'].forEach((c) => s.add(c));
    if (this.active.has('E')) { s.add('GW-IOT-01'); this.gatewayChildren.forEach((c) => s.add(c)); }
    if (this.active.has('F')) s.add('CAM-020');
    if (this.active.has('G')) s.add('RTR-01');
    return s;
  }

  /** Valores "normais" de um dispositivo no instante t (também usado no backfill). */
  normalValues(d, t) {
    const day = Math.sin(((t / 3600000) % 24) / 24 * Math.PI * 2 - Math.PI / 2); // -1 madrugada .. 1 tarde
    const r1 = (x) => Math.round(x * 10) / 10;
    switch (d.type) {
      case 'camera': return { videoOk: true, tamper: false, fps: Math.round(this.n(15, 0.4)), bitrateKbps: Math.round(this.n(2048, 120)), packetLossPct: r1(Math.abs(this.n(0, 0.2))), latencyMs: Math.round(this.n(12, 2.5)), recording: true };
      case 'nvr': return { storageUsedPct: r1(71.3 + (t % 86400000) / 86400000 * 0.4), channelsRecording: this.nvrChannels[d.id] ?? 0, cpuPct: Math.round(this.n(35, 4)) };
      case 'vms': return { cpuPct: Math.round(this.n(40, 5)), memPct: Math.round(this.n(62, 2)), servicesOk: true };
      case 'router': return d.id === 'RTR-02' // link secundário em standby: só keepalive
        ? { wanUp: true, latencyMs: Math.round(this.n(62, 6)), packetLossPct: r1(Math.abs(this.n(0, 0.15))), bandwidthMbps: r1(Math.abs(this.n(0.4, 0.1))), cpuPct: Math.round(this.n(9, 2)) }
        : { wanUp: true, latencyMs: Math.round(this.n(28, 3)), packetLossPct: r1(Math.abs(this.n(0, 0.08))), bandwidthMbps: r1(this.n(42 + 15 * day, 3)), cpuPct: Math.round(this.n(22, 3)) };
      case 'firewall': return { cpuPct: Math.round(this.n(30 + 6 * day, 3)), memPct: Math.round(this.n(55, 2)), sessions: Math.round(this.n(1200 + 300 * day, 60)) };
      case 'switch': return { cpuPct: Math.round(this.n(12, 2)), tempC: r1(this.n(41, 0.6)), portsUp: d.id === 'SW-CORE-01' ? 22 : 6, portsDownUnexpected: 0, ifErrorsPerMin: Math.round(Math.abs(this.n(0, 1))), poeBudgetPct: Math.round(this.n(45, 1.5)) };
      case 'ap': return { clients: Math.max(0, Math.round(this.n(18 + 8 * day, 3))), channelUtilPct: Math.round(this.n(35, 5)) };
      case 'gateway': return { cpuPct: Math.round(this.n(18, 2)), queueDepth: Math.max(0, Math.round(this.n(3, 2))), sensorsReporting: this.gatewayChildren.length };
      case 'server': return { cpuPct: Math.round(this.n(38 + 10 * day, 5)), memPct: Math.round(this.n(64, 2)), diskPct: 58.2, tempC: r1(this.n(52, 1.2)), servicesOk: true, hwFault: false };
      case 'storage': return { usedPct: 66.8, diskHealthOk: true, tempC: r1(this.n(38, 0.6)) };
      case 'ups': { const u = this.ups[d.id]; return { onBattery: false, batteryPct: 100, runtimeMin: u.fullRuntime, loadPct: Math.round(this.n(42, 1.5)), batteryHealthPct: u.health, inputV: Math.round(this.n(220, 1.5)) }; }
      case 'meter': { const kW = r1(this.n(6.2 + 1.5 * day, 0.12)); const pf = Math.round(this.n(0.95, 0.004) * 1000) / 1000; return { voltageV: Math.round(this.n(220, 1.5)), currentA: r1(kW * 1000 / (220 * pf)), kW, kWhToday: r1(this.kwhToday), pf }; }
      case 'pdu': return { kW: r1(this.n(2.1, 0.08)), loadPct: Math.round(this.n(38, 1.5)) };
      case 'smoke': case 'mcp': return { state: 'normal' };
      case 'facp': return { state: 'normal', zonesInAlarm: 0, acPowerOk: true };
      case 'alarmpanel': return { armed: 'desarmada', tamper: false, acPowerOk: true, monitoringLinkOk: true };
      case 'sensor': return { state: 'normal' };
      case 'access': return { doorForced: false, readersOk: true };
      case 'reader': return { online: true };
      case 'vault': return { sensorState: 'fechado', alarm: false, powerOk: true };
      case 'th': { const base = { 'TH-01': 23, 'TH-02': 24, 'TH-03': 22.5 }[d.id] ?? 23; return { tempC: r1(this.n(base, 0.25)), humidityPct: Math.round(this.n(46, 1.5)) }; }
      case 'leak': return { wet: false };
      case 'hvac': return { running: true, supplyTempC: r1(this.n(14, 0.4)) };
      case 'atm': return { inService: true, deviceFaults: 0 };
      case 'totem': return { inService: true };
      default: return {};
    }
  }

  applyScenarios(d, v, now) {
    const A = this.active;
    if (A.has('A') && d.id === 'CAM-018') Object.assign(v, { videoOk: false, fps: 0, bitrateKbps: 0, recording: false });
    if (A.has('B')) {
      if (d.id === 'SW-CORE-01') Object.assign(v, { portsUp: v.portsUp - 1, portsDownUnexpected: 1 });
      if (d.id === 'NVR-02') v.channelsRecording -= this.sw03Children.length;
    }
    if (A.has('A') && d.id === 'NVR-02') v.channelsRecording -= 1;
    if (A.has('F')) {
      if (d.id === 'NVR-02') v.channelsRecording -= 1;
      if (d.id === 'VAULT-01') v.powerOk = false;
    }
    if (A.has('G') && d.id === 'RTR-02') Object.assign(v, { latencyMs: Math.round(this.n(95, 8)), bandwidthMbps: Math.round(this.n(38, 3) * 10) / 10, cpuPct: Math.round(this.n(46, 4)) });
    if (A.has('H')) {
      const el = now - A.get('H').startedAt;
      const kHvac = Math.min(1, el / 20_000);                              // insuflamento esquenta primeiro
      const k = Math.min(1, Math.max(0, el - 15_000) / THERMAL_RAMP_MS);  // inércia térmica do ambiente
      const r1 = (x) => Math.round(x * 10) / 10;
      if (d.id === 'HVAC-01') v.supplyTempC = r1(v.supplyTempC + 9 * kHvac);
      if (d.id === 'TH-01') v.tempC = r1(v.tempC + 11 * k);
      if (d.id === 'TH-02') v.tempC = r1(v.tempC + 7 * k);
      if (d.id === 'SRV-01') v.tempC = r1(v.tempC + 30 * k);
      if (d.id === 'STG-01') v.tempC = r1(v.tempC + 20 * k);
      if (d.id === 'NVR-01' || d.id === 'NVR-02') v.cpuPct = Math.round(v.cpuPct + 15 * k);
    }
    if (A.has('C')) {
      if (d.type === 'meter') Object.assign(v, { voltageV: 0, currentA: 0, kW: 0 }), delete v.pf;
      if (d.type === 'ups') {
        const u = this.ups[d.id];
        Object.assign(v, { onBattery: true, inputV: 0, batteryPct: Math.round(u.battery), runtimeMin: Math.round(u.fullRuntime * u.battery / 100 * 10) / 10 });
      }
      if (d.type === 'hvac') Object.assign(v, { running: false });
      if (d.type === 'facp' || d.type === 'alarmpanel') v.acPowerOk = false;
    }
    if (A.has('D')) {
      if (d.id === 'SD-04') v.state = 'alarme';
      if (d.type === 'facp') Object.assign(v, { state: 'alarme', zonesInAlarm: 1 });
    }
    if (A.has('E') && d.type === 'gateway') v.sensorsReporting = 0;
    return v;
  }

  /** Avança o relógio e devolve as leituras devidas neste tick. */
  tick(now) {
    const dt = this.lastTick ? (now - this.lastTick) / 1000 : 0;
    this.lastTick = now;
    this.kwhToday += (this.active.has('C') ? 0 : 6.2) * dt / 3600;
    for (const u of Object.values(this.ups)) {
      if (this.active.has('C')) u.battery = Math.max(5, u.battery - (100 / (u.fullRuntime * 60)) * dt * TIME_ACCELERATION);
      else u.battery = 100;
    }
    const silent = this.silenced();
    const out = [];
    for (const d of this.devices) {
      const due = this.nextDue.get(d.id) ?? 0;
      if (now < due) continue;
      const iv = TYPES[d.type].intervalMs;
      this.nextDue.set(d.id, now + iv * (0.85 + this.rng() * 0.2));
      if (silent.has(d.id)) continue;
      const values = this.applyScenarios(d, this.normalValues(d, now), now);
      out.push({ deviceId: d.id, sourceTs: now - Math.round(this.rng() * 150), values });
    }
    return out;
  }

  start(id, now) {
    if (!SCENARIOS[id]) return false;
    if (!this.active.has(id)) this.active.set(id, { startedAt: now });
    return true;
  }
  stop(id) { return this.active.delete(id); }
  reset() { this.active.clear(); for (const u of Object.values(this.ups)) u.battery = 100; }
}
