// Painel contextual (direita): equipamento selecionado, diagnóstico de incidente ou visão resumida.

import { api } from './api.mjs';
import { h, statusBadge, statusIcon, sevTag, fmtAge, fmtTime, fmtValue, toast, kpiText, STATUS_ORDER } from './util.mjs';
import { sparkline } from './charts.mjs';

// replaceChildren converteria null em texto "null": filtra antes
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

const STATUS_TXT = { aberto: 'Aberto', reconhecido: 'Reconhecido', normalizado: 'Normalizado — aguardando encerramento', resolvido: 'Resolvido' };

export function renderPanel(app, { force = false } = {}) {
  const el = document.getElementById('context');
  // não atropela o operador digitando
  if (!force && (el.contains(document.activeElement) && document.activeElement.matches('textarea,input') || [...el.querySelectorAll('textarea')].some((t) => t.value))) return;
  const scroll = el.scrollTop;
  const sel = app.selected;
  if (sel?.type === 'device') return renderDevice(app, el, sel.id).then(() => { el.scrollTop = scroll; });
  if (sel?.type === 'incident') { renderIncident(app, el, sel.id); el.scrollTop = scroll; return; }
  renderOverview(app, el);
}

// pior estado de um conjunto (ordem de gravidade)
const worst = (statuses) => statuses.sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b))[0] ?? 'ok';
const HEALTH = { ok: ['Normal', 'ok'], maintenance: ['Manutenção', 'maintenance'], degraded: ['Atenção', 'degraded'], unknown: ['Sem dados', 'unknown'], offline: ['Falha', 'critical'], critical: ['Falha', 'critical'] };

// ícones dos domínios (SVG simples, 24×24) — mesma leitura do mapa conceitual
const DOMAIN_ICON = {
  cftv: 'M3 7h12l4-3v10l-4-3H3zM6 9.5a1.5 1.5 0 1 0 0 .01M5 14h4v5H5z',
  rede: 'M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm14 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM11 7h2v4h6v4h-2v-2H7v2H5v-4h6z',
  energia: 'M13 2 4 14h7l-1 8 9-12h-7z',
  clima: 'M11 2h2v20h-2zM2 11h20v2H2zM4.9 3.5l15.6 15.6-1.4 1.4L3.5 4.9zM19.1 3.5l1.4 1.4L4.9 20.5l-1.4-1.4z',
  incendio: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z',
  seguranca: 'M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z',
  servidor: 'M4 3h16v5H4zm0 7h16v5H4zm0 7h16v4H4zM6 5h2v1H6zm0 7h2v1H6z',
  autoatend: 'M5 2h14v20H5zm2 2v7h10V4zm1 10h8v2H8zm0 4h3v2H8z',
};
const domainIcon = (id) => h('svg', { svg: true, class: 'dom-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { svg: true, d: DOMAIN_ICON[id] ?? DOMAIN_ICON.servidor, fill: 'currentColor' }));

function renderOverview(app, el) {
  const incs = app.live.incidents.slice().sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.createdAt - a.createdAt);
  const live = [...app.live.devices.values()];
  const statusOf = (id) => app.live.devices.get(id)?.status ?? 'unknown';
  const bad = live.filter((d) => d.status !== 'ok').sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const cnt = (st) => live.filter((d) => st.includes(d.status)).length;
  const statics = [...app.statics.values()];
  app.openGroups ??= new Set();

  // 1) Ambientes (legenda numerada do mapa)
  const rooms = app.layout.rooms.filter((r) => r.num).sort((a, b) => a.num.localeCompare(b.num));
  const roomSec = h('section', { class: 'ctx-sec' }, h('h3', { text: 'Ambientes' }), h('ul', { class: 'room-legend' }, rooms.map((r) => {
    const devs = statics.filter((d) => d.room === r.id);
    const st = devs.length ? worst(devs.map((d) => statusOf(d.id))) : null;
    const locked = r.restricted && !app.can('read:restricted');
    return h('li', {}, h('button', { onclick: () => app.flyToRoom(r.id), title: `Ir até ${r.name}` },
      h('span', { class: `rnum${r.tech ? ' tech' : ''}`, text: r.num }),
      h('span', { class: 'rtxt' }, h('b', { text: r.name.toUpperCase() }), h('small', { text: locked ? `${r.desc} · acesso restrito` : r.desc })),
      st && !locked ? h('span', { class: `rdot s-${st}`, title: app.meta.statuses[st].label }, statusIcon(st)) : null));
  })));

  // 2) Status dos equipamentos (legenda do mapa: Online / Instável / Offline)
  const big = (label, sub, n, cls) => h('div', { class: `bigstat ${cls}` }, h('span', { class: 'dot' }), h('div', {}, h('b', { text: `${label} · ${n}` }), h('small', { text: sub })));
  const statusSec = h('section', { class: 'ctx-sec' }, h('h3', { text: 'Status dos equipamentos' }),
    h('div', { class: 'bigstats' }, big('ONLINE', 'Operando normalmente', cnt(['ok']), 'ok'), big('INSTÁVEL', 'Atenção necessária', cnt(['degraded']), 'warn'), big('OFFLINE', 'Fora de operação', cnt(['critical', 'offline']), 'crit')),
    h('p', { class: 'row-sub', text: `Sem dados confiáveis: ${cnt(['unknown'])} · Manutenção: ${cnt(['maintenance'])} · ${live.length} visíveis ao perfil` }));

  // 3) Monitoramento geral por domínio
  const domSec = h('section', { class: 'ctx-sec' }, h('h3', { text: 'Monitoramento geral' }), h('div', { class: 'domains' }, app.layout.monitorDomains.map((dm) => {
    const devs = statics.filter((d) => dm.categories.includes(d.category));
    if (!devs.length) return null;
    const [txt, cls] = HEALTH[worst(devs.map((d) => statusOf(d.id)))];
    return h('button', { class: `domain h-${cls}`, title: `Filtrar ${dm.label} no 3D`, onclick: () => { app.setCategoryFilter(dm.categories); app.go('twin'); } },
      domainIcon(dm.id), h('b', { text: dm.label.toUpperCase() }), h('small', { text: txt }));
  })));

  // 4) Mapa de ativos (grupos e contagens do mapa conceitual)
  const assetSec = h('section', { class: 'ctx-sec' }, h('h3', { text: 'Mapa de ativos' }), h('ul', { class: 'assets' }, app.layout.assetGroups.map((g) => {
    const devs = statics.filter((d) => g.types.includes(d.type));
    const st = devs.length ? worst(devs.map((d) => statusOf(d.id))) : null;
    const det = h('details', { open: app.openGroups.has(g.id) || null, ontoggle: (e) => { if (e.target.open) app.openGroups.add(g.id); else app.openGroups.delete(g.id); } },
      h('summary', {}, h('span', { text: g.label }), h('span', { class: 'units', text: `${devs.length} unidade${devs.length === 1 ? '' : 's'}` }),
        st ? h('span', { class: `rdot s-${st}`, title: app.meta.statuses[st].label }, statusIcon(st)) : h('span', { class: 'row-sub', text: 'restrito' })),
      h('ul', { class: 'list' }, devs.map((d) => { const l = app.live.devices.get(d.id); return h('li', {}, h('button', { onclick: () => app.select(d.id) },
        h('div', { class: 'row-top' }, h('span', { class: 'mono', text: d.id }), statusBadge(l?.status ?? 'unknown', app.meta.statuses[l?.status ?? 'unknown'].label)),
        h('div', { class: 'row-sub', text: `${d.name} · ${['offline', 'unknown'].includes(l?.status) ? 'sem dados recentes' : kpiText(d.type, l?.values)}` }))); })));
    return h('li', {}, det);
  })));

  // 5) Desempenho — indicadores-chave ao vivo
  const perfRow = (label, id, fmt) => {
    const l = app.live.devices.get(id);
    if (!l) return null;
    const stale = ['offline', 'unknown'].includes(l.status);
    return [h('dt', { text: label }), h('dd', { class: { critical: 'bad', offline: 'bad', degraded: 'warn', unknown: 'warn' }[l.status] ?? '', text: stale ? `sem dados (${fmtAge(l.ageMs)})` : fmt(l.values) })];
  };
  const recCams = ['NVR-01', 'NVR-02'].reduce((a, id) => a + (app.live.devices.get(id)?.values?.channelsRecording ?? 0), 0);
  const totalCams = statics.filter((d) => d.type === 'camera').length;
  const perfSec = h('section', { class: 'ctx-sec' }, h('h3', {}, h('span', { text: 'Desempenho' }), h('span', { class: 'pill synthetic', text: 'simulado' })),
    h('dl', { class: 'kv' },
      perfRow('Link WAN principal', 'RTR-01', (v) => `${v.latencyMs} ms · ${v.bandwidthMbps} Mb/s`),
      perfRow('Link secundário (4G)', 'RTR-02', (v) => `${v.bandwidthMbps > 5 ? 'ATIVO' : 'standby'} · ${v.latencyMs} ms`),
      app.live.devices.has('NVR-01') ? [h('dt', { text: 'Câmeras gravando' }), h('dd', { class: recCams < totalCams ? 'warn' : '', text: `${recCams} de ${totalCams}` })] : null,
      perfRow('Host de virtualização', 'SRV-01', (v) => `CPU ${v.cpuPct}% · ${v.tempC} °C`),
      perfRow('Temperatura dos racks', 'TH-01', (v) => `${v.tempC} °C`),
      perfRow('Climatização', 'HVAC-01', (v) => (v.running ? `insuflamento ${v.supplyTempC} °C` : 'parada')),
      perfRow('Potência (QDG)', 'MTR-01', (v) => `${v.kW} kW · ${v.voltageV} V`),
      perfRow('Autonomia UPS-01', 'UPS-01', (v) => (v.onBattery ? `EM BATERIA · ${v.runtimeMin} min` : `rede · ${v.runtimeMin} min disponíveis`)),
    ));

  fill(el,
    h('div', { class: 'ctx-head' }, h('div', {}, h('h2', { text: 'Mapa de ativos · visão operacional' }), h('div', { class: 'sub', text: 'Estados calculados pela telemetria (simulada). Clique para navegar.' }))),
    h('section', { class: 'ctx-sec' }, h('h3', {}, h('span', { text: 'Incidentes ativos' }), h('span', { class: `badge ${incs.length ? '' : 'zero'}`, text: incs.length })),
      incs.length ? h('ul', { class: 'list' }, incs.map((i) => h('li', {}, h('button', { onclick: () => app.selectIncident(i.id) },
        h('div', { class: 'row-top' }, h('strong', { text: i.title }), sevTag(i.severity)),
        h('div', { class: 'row-sub', text: `${i.id} · ${STATUS_TXT[i.status]} · ${fmtAge(Date.now() - i.createdAt)}` }))))) : h('p', { class: 'empty', text: 'Nenhum incidente ativo.' })),
    statusSec, domSec, roomSec, assetSec, perfSec,
    bad.length ? h('section', { class: 'ctx-sec' }, h('h3', { text: 'Equipamentos fora do normal' }),
      h('ul', { class: 'list' }, bad.slice(0, 30).map((d) => { const st = app.statics.get(d.id); return h('li', {}, h('button', { onclick: () => app.select(d.id) },
        h('div', { class: 'row-top' }, h('strong', { text: `${d.id}` }), statusBadge(d.status, app.meta.statuses[d.status].label)),
        h('div', { class: 'row-sub', text: `${st?.name ?? ''} — ${d.reasons[0]?.text ?? ''}` }))); }))) : null,
  );
}

const sevRank = (s) => ({ critical: 3, high: 2, medium: 1, low: 0 }[s] ?? 0);

async function renderDevice(app, el, id) {
  let data;
  try { data = await api.get(`/api/devices/${encodeURIComponent(id)}`); }
  catch (e) { el.replaceChildren(h('p', { class: 'empty', text: `Equipamento indisponível para o seu perfil (${e.message}).` })); return; }
  if (app.selected?.id !== id) return; // seleção mudou durante o fetch
  const d = data.device;
  const st = app.meta.statuses[d.status];
  const room = app.layout.rooms.find((r) => r.id === d.room);
  const metricRows = data.metrics.map((m) => {
    const v = d.values[m.key];
    const bad = d.reasons.find((r) => r.metric === m.key);
    const lim = [m.warn && `alerta ${opTxt(m.warn)}`, m.crit && `crítico ${opTxt(m.crit)}`].filter(Boolean).join(' · ');
    return [h('dt', { text: m.label, title: lim || 'sem limiar configurado' }), h('dd', { class: bad ? (bad.level === 'critical' ? 'bad' : 'warn') : '', text: fmtValue(v, m.unit) })];
  });
  const numeric = data.metrics.find((m) => m.stat || m.trend) || data.metrics.find((m) => typeof d.values[m.key] === 'number');
  const stale = ['offline', 'unknown'].includes(d.status);
  const up = data.deps.filter((e) => e.to === d.id), down = data.deps.filter((e) => e.from === d.id);

  fill(el,
    h('div', { class: 'ctx-head' },
      h('div', {}, h('h2', { text: d.name }), h('div', { class: 'sub mono', text: `${d.id} · ${d.typeLabel} · ${room?.name ?? d.room}` })),
      h('button', { class: 'btn icon ghost', 'aria-label': 'Fechar', onclick: () => app.clearSelection() }, '✕')),
    h('div', {}, statusBadge(d.status, st.label), ' ', d.maintenance ? h('span', { class: 'pill', text: `manutenção: ${d.maintenance.note || 'sem nota'}` }) : null),
    h('section', { class: 'ctx-sec' }, h('h3', { text: 'Motivos (regras aplicadas)' }),
      d.reasons.length ? d.reasons.map((r) => h('div', { class: `reason ${r.level}`, text: r.text })) : h('div', { class: 'reason', text: 'Todas as regras atendidas na última leitura.' })),
    h('section', { class: 'ctx-sec' }, h('h3', {}, h('span', { text: stale ? 'Últimas leituras (antigas — não são estado atual)' : 'Telemetria' }), h('span', { class: 'pill synthetic', text: 'simulada' })),
      h('dl', { class: 'kv' }, metricRows,
        h('dt', { text: 'Última comunicação' }), h('dd', { class: stale ? 'bad' : '', text: `${fmtAge(d.ageMs)} (limite ${data.staleAfterMs / 1000} s)` }),
        h('dt', { text: 'Timestamp de origem' }), h('dd', { class: 'mono', text: fmtTime(d.sourceTs, true) }),
        h('dt', { text: 'Qualidade da medição' }), h('dd', { text: d.quality ?? '—' }))),
    numeric ? h('section', { class: 'ctx-sec' }, h('h3', { text: `Histórico — ${numeric.label}` }), sparkline(data.history.map((p) => ({ t: p.t, v: p.values[numeric.key] })), stale ? '#9ca3af' : '#22d3ee')) : null,
    data.trend ? trendBlock(data.trend) : null,
    h('section', { class: 'ctx-sec' }, h('h3', { text: 'Inventário técnico' }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Fabricante / modelo' }), h('dd', { text: `${d.manufacturer} / ${d.model}` }),
        d.serial ? [h('dt', { text: 'Nº de série' }), h('dd', { class: 'mono', text: d.serial })] : null,
        d.ip ? [h('dt', { text: 'Endereço de rede' }), h('dd', { class: 'mono', text: d.ip })] : [h('dt', { text: 'Endereço de rede' }), h('dd', { text: 'restrito ao perfil' })],
        h('dt', { text: 'Coordenadas 3D' }), h('dd', { class: 'mono', text: d.pos.map((n) => n.toFixed(2)).join(', ') }),
        h('dt', { text: 'Fonte de telemetria' }), h('dd', { text: `${d.source.connector} (${d.source.protocol})` }),
        h('dt', { text: 'Responsável técnico' }), h('dd', { text: d.owner }),
        h('dt', { text: 'Última manutenção' }), h('dd', { text: d.lastMaintenance }))),
    h('section', { class: 'ctx-sec' }, h('h3', { text: 'Dependências' }),
      up.length || down.length ? h('ul', { class: 'list' },
        up.map((e) => depItem(app, e.from, `depende de · ${app.meta.edgeLabels[e.type]}`, e.kind)),
        down.map((e) => depItem(app, e.to, `alimenta/atende · ${app.meta.edgeLabels[e.type]}`, e.kind))) : h('p', { class: 'empty', text: 'Nenhuma dependência visível.' })),
    d.type === 'camera' ? videoSection(app, d) : null,
    data.incidents.length ? h('section', { class: 'ctx-sec' }, h('h3', { text: 'Incidentes relacionados' }), h('ul', { class: 'list' }, data.incidents.slice().reverse().map((i) => h('li', {}, h('button', { onclick: () => app.selectIncident(i.id) }, h('div', { class: 'row-top' }, h('span', { text: i.title }), sevTag(i.severity)), h('div', { class: 'row-sub', text: `${i.id} · ${STATUS_TXT[i.status] ?? i.status}${i.synthetic === 'history' ? ' · histórico sintético' : ''}` })))))) : null,
    data.events.length ? h('section', { class: 'ctx-sec' }, h('h3', { text: 'Eventos recentes' }), h('ul', { class: 'list' }, data.events.slice().reverse().slice(0, 8).map((e) => h('li', { class: 'row-sub', text: `${fmtTime(e.ts)} — ${e.text}` })))) : null,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => app.focus(d.id) }, 'Ir até no 3D'),
      app.can('device:maintenance') ? h('button', { class: 'btn', onclick: () => toggleMaintenance(app, d) }, d.maintenance ? 'Encerrar manutenção' : 'Marcar manutenção') : null),
  );
}

function opTxt(c) { return `${{ gt: '>', lt: '<', eq: '=', in: '∈' }[c.op]} ${Array.isArray(c.v) ? c.v.join('/') : fmtValue(c.v)}`; }

function depItem(app, id, label, kind) {
  const live = app.live.devices.get(id);
  return h('li', {}, h('button', { onclick: () => app.select(id) },
    h('div', { class: 'row-top' }, h('span', { class: 'mono', text: id }), live ? statusBadge(live.status, app.meta.statuses[live.status].label) : null),
    h('div', { class: 'row-sub', text: `${label} · relação ${kind}` })));
}

function trendBlock(tr) {
  const a = tr.analysis;
  const text = a?.projection
    ? `Queda de ${Math.abs(a.slopePerDay).toFixed(2)} p.p./dia (R² ${a.r2.toFixed(2)}, n = ${a.n}). Projeção: ${a.projection.threshold}% em ~${Math.round(a.projection.daysToThreshold)} dias, se a tendência linear se mantiver.`
    : `Sem projeção: ${a?.reason ?? 'dados insuficientes'}.`;
  return h('section', { class: 'ctx-sec' }, h('h3', {}, h('span', { text: 'Tendência — saúde da bateria' }), h('span', { class: 'pill synthetic', text: 'série sintética' })),
    sparkline(tr.series.map((p) => ({ t: p.t, v: p.v })), '#eab308'), h('p', { class: 'row-sub', text }));
}

async function toggleMaintenance(app, d) {
  const on = !d.maintenance;
  const note = on ? prompt('Motivo da manutenção (registrado na auditoria):', '') : '';
  if (on && note === null) return;
  try { await api.post(`/api/devices/${d.id}/maintenance`, { on, note }); toast(`${d.id}: manutenção ${on ? 'iniciada' : 'encerrada'}`); renderPanel(app, { force: true }); }
  catch (e) { toast(e.message, 'critical'); }
}

function videoSection(app, d) {
  const sec = h('section', { class: 'ctx-sec' }, h('h3', { text: 'Vídeo' }));
  if (!app.can('read:video')) { sec.append(h('div', { class: 'locked-box', text: 'Painel de vídeo disponível apenas para perfis autorizados (Operador/Administrador).' })); return sec; }
  const btn = h('button', { class: 'btn', onclick: async () => {
    try {
      const v = await api.get(`/api/devices/${d.id}/video`);
      btn.replaceWith(videoCanvas(d.id, v), h('p', { class: 'row-sub', text: `${v.reason} Acesso registrado em auditoria.` }));
    } catch (e) { toast(e.message, 'critical'); }
  } }, 'Abrir painel de vídeo (auditado)');
  sec.append(btn);
  return sec;
}

/** Quadro SINTÉTICO — não há stream real sem integração homologada com o VMS. */
export function videoCanvas(id, v) {
  const c = h('canvas', { width: 480, height: 270, 'aria-label': `Quadro sintético da câmera ${id}` });
  const g = c.getContext('2d');
  const box = h('div', { class: 'video-box' }, c);
  let last = 0;
  const draw = (t) => {
    if (!c.isConnected && last) return;
    if (t - last > 200) {
      last = t;
      if (v.signal === 'ok') {
        const img = g.createImageData(480, 270);
        for (let i = 0; i < img.data.length; i += 4) { const n = 30 + Math.random() * 40; img.data[i] = n; img.data[i + 1] = n + 6; img.data[i + 2] = n + 10; img.data[i + 3] = 255; }
        g.putImageData(img, 0, 0);
        g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeRect(60, 60, 360, 150);
        g.fillStyle = '#facc15'; g.font = '600 16px sans-serif'; g.fillText('QUADRO SINTÉTICO — SEM INTEGRAÇÃO VMS', 70, 140);
      } else {
        g.fillStyle = '#000'; g.fillRect(0, 0, 480, 270);
        g.fillStyle = '#ef4444'; g.font = '700 20px sans-serif';
        g.fillText(v.signal === 'sem-video' ? 'SEM SINAL DE VÍDEO' : 'SEM DADOS CONFIÁVEIS', 130, 140);
      }
      g.fillStyle = '#fff'; g.font = '12px monospace'; g.fillText(`${id}  ${new Date().toLocaleString('pt-BR')}  SIMULADO`, 10, 260);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return box;
}

function renderIncident(app, el, id) {
  const inc = app.live.incidents.find((i) => i.id === id) || app.incidentCache.get(id);
  if (!inc) { el.replaceChildren(h('p', { class: 'empty', text: 'Incidente não encontrado.' })); return; }
  app.incidentCache.set(id, inc);
  const dx = inc.diagnosis;
  fill(el,
    h('div', { class: 'ctx-head' },
      h('div', {}, h('h2', { text: inc.title }), h('div', { class: 'sub mono', text: `${inc.id} · ${STATUS_TXT[inc.status] ?? inc.status}` })),
      h('button', { class: 'btn icon ghost', 'aria-label': 'Fechar', onclick: () => app.clearSelection() }, '✕')),
    h('div', { class: 'toolbar' }, sevTag(inc.severity), h('span', { class: 'pill', text: `Prioridade ${inc.priority}` }),
      inc.escalationLevel > 1 ? h('span', { class: 'pill', text: `Escalonado nível ${inc.escalationLevel}` }) : null,
      inc.synthetic === 'history' ? h('span', { class: 'pill synthetic', text: 'histórico sintético' }) : h('span', { class: 'pill synthetic', text: 'dados simulados' })),
    inc.redacted ? h('div', { class: 'locked-box', text: 'Detalhes restritos ao perfil Operador/Administrador.' }) : null,
    dx ? h('div', { class: 'dx ctx-sec' },
      h('div', { class: 'dx-block' }, h('h4', { text: 'Incidente identificado' }), h('p', { text: dx.title })),
      h('div', { class: 'dx-block' }, h('h4', { text: 'Evidências disponíveis (fatos coletados)' }), h('ul', {}, dx.facts.map((f) => h('li', { text: f })))),
      h('div', { class: 'dx-block hyp' }, h('h4', { text: 'Hipótese técnica' }), h('p', { text: dx.hypothesis }), dx.relation === 'inferida' ? h('span', { class: 'pill inferred', text: 'relação inferida' }) : null),
      h('div', { class: 'dx-block' }, h('h4', { text: `Confiança: ${dx.confidence}` }), h('ul', {}, (dx.confidenceCriteria || []).map((c) => h('li', { text: c }))),
        h('p', { class: 'dx-meta', text: 'Confiança qualitativa derivada dos critérios acima — sem percentuais arbitrários.' })),
      dx.recommendations?.length ? h('div', { class: 'dx-block' }, h('h4', { text: 'Ações recomendadas' }), h('ul', {}, dx.recommendations.map((r) => h('li', { text: r })))) : null,
      dx.protocol ? h('div', { class: 'dx-block proto' }, h('h4', { text: 'Protocolo de escalonamento' }), h('p', { class: 'dx-meta', text: dx.protocol.note }), h('ol', {}, dx.protocol.steps.map((s) => h('li', { text: s })))) : null,
      dx.uncertainties?.length ? h('div', { class: 'dx-block' }, h('h4', { text: 'Incertezas' }), h('ul', {}, dx.uncertainties.map((r) => h('li', { text: r })))) : null,
      h('p', { class: 'dx-meta', text: `Gerado por ${dx.engine} em ${fmtTime(dx.generatedAt, true)}` })) : null,
    inc.deviceIds?.length ? h('section', { class: 'ctx-sec' }, h('h3', { text: `Equipamentos (${inc.deviceIds.length}) · ${inc.suppressedDuplicates ?? 0} alerta(s) duplicado(s) suprimido(s)` }),
      h('ul', { class: 'list' }, inc.deviceIds.map((id) => depItem(app, id, id === inc.rootDeviceId ? 'causa raiz provável' : 'afetado', dx?.relation ?? 'conhecida')))) : null,
    h('section', { class: 'ctx-sec' }, h('h3', { text: 'Linha do tempo' }), h('ul', { class: 'list' }, (inc.timeline || []).slice().reverse().map((t) => h('li', { class: 'row-sub', text: `${fmtTime(t.ts, true)} — ${t.text}` })))),
    incidentActions(app, inc),
  );
  app.scene?.highlightIncident(inc);
}

function incidentActions(app, inc) {
  if (inc.status === 'resolvido' || inc.redacted) return h('div', { class: 'actions' }, inc.rootDeviceId ? h('button', { class: 'btn', onclick: () => app.focus(inc.rootDeviceId) }, 'Ir até no 3D') : null);
  const note = h('textarea', { class: 'note-input', placeholder: 'Resolução e evidências (obrigatório para encerrar)', maxlength: 1000 });
  return h('div', {},
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => app.focus(inc.rootDeviceId) }, 'Ir até no 3D'),
      app.can('incident:ack') && !inc.ackAt ? h('button', { class: 'btn', onclick: async () => { try { await api.post(`/api/incidents/${inc.id}/ack`); toast(`${inc.id} reconhecido`); } catch (e) { toast(e.message, 'critical'); } } }, 'Reconhecer') : null),
    app.can('incident:resolve') ? h('div', { class: 'ctx-sec' }, note,
      h('div', { class: 'actions' }, h('button', { class: 'btn', disabled: inc.status !== 'normalizado', title: inc.status !== 'normalizado' ? 'A condição ainda está ativa na telemetria' : '', onclick: async () => {
        try { await api.post(`/api/incidents/${inc.id}/resolve`, { note: note.value }); note.value = ''; toast(`${inc.id} resolvido`); app.clearSelection(); }
        catch (e) { toast(e.message, 'critical'); }
      } }, 'Resolver e registrar evidências'))) : null);
}
