// Utilitários de DOM. Todo texto vindo da API entra via textContent (nunca innerHTML) — defesa contra XSS.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElementNS(attrs.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v; // via CSSOM: compatível com CSP sem 'unsafe-inline'
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export const STATUS_ORDER = ['critical', 'offline', 'unknown', 'degraded', 'maintenance', 'ok'];

// Ícones por estado: forma distinta para não depender só de cor (WCAG 1.4.1).
export const ICON_PATHS = {
  ok: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm3.2 4.6-3.9 4.4-2.4-2.2.9-1 1.4 1.3 3-3.4 1 .9Z',
  degraded: 'M8 1.2 15 14H1L8 1.2Zm-.8 4.3v4.2h1.6V5.5H7.2Zm0 5.4v1.6h1.6v-1.6H7.2Z',
  critical: 'M8 .8 15.2 8 8 15.2.8 8 8 .8Zm-2.1 4L4.8 5.9 6.9 8l-2.1 2.1 1.1 1.1L8 9.1l2.1 2.1 1.1-1.1L9.1 8l2.1-2.1-1.1-1.1L8 6.9 5.9 4.8Z',
  offline: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8ZM4.5 7.2h7v1.6h-7z',
  maintenance: 'M2 2h12v12H2V2Zm7.6 2.2a2.4 2.4 0 0 0-2.9 3L4 9.9 6.1 12l2.7-2.7a2.4 2.4 0 0 0 3-2.9l-1.4 1.4-1.4-.3-.3-1.4 1.4-1.4-.5-.5Z',
  unknown: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm.1 2.6c1.6 0 2.7 1 2.7 2.3 0 1-.6 1.6-1.4 2.1-.5.3-.6.5-.6 1v.4H7.2v-.5c0-.9.3-1.4 1-1.9.6-.4.9-.6.9-1.1 0-.5-.4-.8-1-.8-.6 0-1 .4-1.1 1H5.3c.1-1.5 1.2-2.5 2.8-2.5ZM7.2 10.7h1.7v1.6H7.2v-1.6Z',
};

export function statusIcon(status) {
  return h('svg', { svg: true, class: 'ico', viewBox: '0 0 16 16', 'aria-hidden': 'true' }, h('path', { svg: true, d: ICON_PATHS[status] || ICON_PATHS.unknown, fill: 'currentColor' }));
}

export function statusBadge(status, label) {
  return h('span', { class: `status s-${status}` }, statusIcon(status), h('span', { text: label }));
}

export const SEV_LABEL = { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa', info: 'Info' };
export const sevTag = (sev) => h('span', { class: `sev sev-${sev}`, text: SEV_LABEL[sev] || sev });

export function fmtTime(ts, withDate = false) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', withDate ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtAge(ms) {
  if (ms == null) return 'nunca';
  if (ms < 1500) return 'agora';
  if (ms < 60000) return `há ${Math.round(ms / 1000)} s`;
  if (ms < 3600000) return `há ${Math.round(ms / 60000)} min`;
  return `há ${(ms / 3600000).toFixed(1)} h`;
}

export function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
  return `${(ms / 3600000).toFixed(1)} h`;
}

export function fmtValue(v, unit) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'number') return `${Number.isInteger(v) ? v : v.toFixed(v < 10 ? 2 : 1)}${unit ? ' ' + unit : ''}`;
  return String(v);
}

export function throttle(fn, ms) {
  let last = 0, timer = null;
  return (...args) => {
    const now = performance.now();
    const run = () => { last = performance.now(); timer = null; fn(...args); };
    if (now - last >= ms) run();
    else if (!timer) timer = setTimeout(run, ms - (now - last));
  };
}

export function toast(text, level = 'info', onClick) {
  const el = h('div', { class: `toast ${level}`, role: 'status', text });
  el.addEventListener('click', () => { onClick?.(); el.remove(); });
  document.getElementById('toasts').prepend(el);
  setTimeout(() => el.remove(), 7000);
}

/** KPI principal de desempenho por tipo de equipamento (camada "Desempenho" e painel). */
export function kpiText(type, v = {}) {
  const n = (x, d = 0) => (typeof x === 'number' ? x.toFixed(d) : '—');
  switch (type) {
    case 'camera': return v.videoOk === false ? 'SEM VÍDEO' : `${n(v.fps)} fps · ${n((v.bitrateKbps ?? 0) / 1000, 1)} Mb/s`;
    case 'nvr': return `${n(v.storageUsedPct)}% disco · ${n(v.channelsRecording)} canais`;
    case 'vms': return `CPU ${n(v.cpuPct)}% · mem ${n(v.memPct)}%`;
    case 'server': return `CPU ${n(v.cpuPct)}% · ${n(v.tempC)} °C`;
    case 'storage': return `${n(v.usedPct)}% · ${n(v.tempC)} °C`;
    case 'router': return `${n(v.latencyMs)} ms · ${n(v.bandwidthMbps, 1)} Mb/s`;
    case 'firewall': return `CPU ${n(v.cpuPct)}% · ${n(v.sessions)} sessões`;
    case 'switch': return v.portsDownUnexpected ? `${v.portsDownUnexpected} porta(s) inativa(s)` : `CPU ${n(v.cpuPct)}% · ${n(v.tempC)} °C`;
    case 'ap': return `${n(v.clients)} clientes · canal ${n(v.channelUtilPct)}%`;
    case 'gateway': return `fila ${n(v.queueDepth)} · ${n(v.sensorsReporting)} sensores`;
    case 'ups': return v.onBattery ? `BATERIA ${n(v.batteryPct)}% · ${n(v.runtimeMin)} min` : `rede · carga ${n(v.loadPct)}% · saúde ${n(v.batteryHealthPct, 1)}%`;
    case 'meter': return `${n(v.kW, 1)} kW · ${n(v.voltageV)} V`;
    case 'pdu': return `${n(v.kW, 2)} kW · ${n(v.loadPct)}%`;
    case 'smoke': case 'mcp': case 'sensor': return v.state ?? '—';
    case 'facp': return v.state === 'alarme' ? `ALARME · ${v.zonesInAlarm} zona(s)` : (v.acPowerOk === false ? 'normal · sem AC' : v.state ?? '—');
    case 'alarmpanel': return `${v.armed ?? '—'}${v.monitoringLinkOk === false ? ' · sem link' : ''}`;
    case 'access': return v.readersOk === false ? 'falha de leitora' : 'leitoras OK';
    case 'reader': return v.online ? 'operante' : 'inoperante';
    case 'vault': return `${v.sensorState ?? '—'}${v.powerOk === false ? ' · alimentação!' : ''}`;
    case 'th': return `${n(v.tempC, 1)} °C · ${n(v.humidityPct)}%`;
    case 'leak': return v.wet ? 'ÁGUA' : 'seco';
    case 'hvac': return v.running === false ? 'PARADO' : `insufl. ${n(v.supplyTempC, 1)} °C`;
    case 'atm': case 'totem': return v.inService === false ? 'FORA DE SERVIÇO' : 'em serviço';
    default: return '';
  }
}
