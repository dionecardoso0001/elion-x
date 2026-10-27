// Páginas do menu lateral. Todos os números vêm da API (registros simulados/sintéticos rotulados).

import { api, download } from './api.mjs';
import { h, statusBadge, sevTag, fmtAge, fmtTime, fmtDur, fmtValue, toast, STATUS_ORDER } from './util.mjs';
import { lineChart, barChart, timeBars } from './charts.mjs';
import { videoCanvas } from './panel.mjs';

export const MENU = [
  { id: 'overview', label: 'Visão Geral' },
  { id: 'twin', label: 'Gêmeo Digital 3D' },
  { id: 'cftv', label: 'CFTV e Segurança Eletrônica', cats: ['cftv'] },
  { id: 'rede', label: 'Infraestrutura de Redes', cats: ['rede', 'autoatend'] },
  { id: 'servidor', label: 'Servidores e Armazenamento', cats: ['servidor', 'ambiente'] },
  { id: 'alarmes', label: 'Alarmes e Incêndio', cats: ['seguranca', 'incendio'] },
  { id: 'energia', label: 'Energia e Sustentabilidade', cats: ['energia'] },
  { id: 'ai', label: 'Diagnósticos por IA' },
  { id: 'incidents', label: 'Incidentes e Alertas' },
  { id: 'history', label: 'Histórico e Relatórios' },
  { id: 'integrations', label: 'Integrações e Conectores' },
  { id: 'admin', label: 'Administração e Governança' },
];

const CAT_COLORS = { cftv: '#22d3ee', rede: '#38bdf8', servidor: '#818cf8', seguranca: '#f472b6', incendio: '#ef4444', energia: '#f59e0b', ambiente: '#34d399', autoatend: '#a3e635', simulacao: '#facc15', geral: '#94a3b8' };
const SEV_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#94a3b8' };

const fillRoot = (root, ...kids) => root.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

export function renderView(app, id, root) {
  const def = MENU.find((m) => m.id === id);
  if (def?.cats) return categoryView(app, def, root);
  return ({ overview, ai: aiView, incidents: incidentsView, history: historyView, integrations: integrationsView, admin: adminView }[id] || (() => {}))(app, root);
}

function pageHead(title, sub, ...tools) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), h('p', { text: sub })), h('div', { class: 'toolbar' }, tools));
}

function select(label, options, value, onchange) {
  const s = h('select', { onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => h('option', { value: v, selected: v === value || null, text: t })));
  return h('label', {}, label, s);
}

// ---------- 1. Visão Geral ----------
function overview(app, root) {
  const f = app.overviewFilters ??= { period: '1h', category: '', severity: '' };
  const cats = [['', 'Todas'], ...Object.entries(app.meta.categories).map(([k, v]) => [k, v.label])];
  const body = h('div', { class: 'grid wide' });
  const rerender = () => overview(app, root);
  fillRoot(root, 
    pageHead('Visão Geral', 'Indicadores derivados dos registros da plataforma — telemetria simulada e histórico sintético rotulado.',
      select('Período', [['15m', '15 min'], ['1h', '1 hora'], ['6h', '6 horas'], ['24h', '24 horas'], ['7d', '7 dias']], f.period, (v) => { f.period = v; rerender(); }),
      select('Categoria', cats, f.category, (v) => { f.category = v; rerender(); }),
      select('Agência', app.agencies.map((a) => [a.id, a.name]), app.agencies[0]?.id, () => {}),
      select('Criticidade', [['', 'Todas'], ['critical', 'Crítica'], ['high', 'Alta'], ['medium', 'Média']], f.severity, (v) => { f.severity = v; rerender(); })),
    body);
  const load = async () => {
    const s = await api.get(`/api/metrics/summary?period=${f.period}&category=${f.category}&severity=${f.severity}`);
    if (!body.isConnected) return;
    const card = (title, sub) => { const c = h('div', { class: 'card' }, h('h2', { text: title }), h('div', { class: 'sub', text: sub })); const slot = h('div'); c.append(slot); return [c, slot]; };
    const cards = [];
    const [c1, s1] = card('Disponibilidade histórica', f.category ? `% de equipamentos operacionais — ${app.meta.categories[f.category].label}` : '% de equipamentos operacionais (excl. manutenção)'); cards.push(c1);
    const [c2, s2] = card('Consumo de energia', 'Potência ativa medida no QDG (MTR-01)'); cards.push(c2);
    const [c3, s3] = card('Uso de banda — link WAN', 'Medido no roteador RTR-01'); cards.push(c3);
    const [c4, s4] = card('Eventos por categoria', `${Object.values(s.eventsByCategory).reduce((a, b) => a + b, 0)} eventos no período`); cards.push(c4);
    const [c5, s5] = card('Quantidade de incidentes', `${s.incidentCount} incidente(s) no período`); cards.push(c5);
    const [c6, s6] = card('Incidentes por criticidade', 'Inclui histórico sintético quando o período alcança'); cards.push(c6);
    const mt = h('div', { class: 'card' }, h('h2', { text: 'Tempo médio de detecção e recuperação' }), h('div', { class: 'sub', text: 'MTTD = 1º sinal → incidente · MTTR = incidente → resolução' }),
      h('div', { class: 'toolbar' }, h('div', {}, h('div', { class: 'big', text: fmtDur(s.metrics.mttdMs) }), h('div', { class: 'row-sub', text: `MTTD · n = ${s.metrics.nDetect}` })),
        h('div', {}, h('div', { class: 'big', text: fmtDur(s.metrics.mttrMs) }), h('div', { class: 'row-sub', text: `MTTR · n = ${s.metrics.nRecover}` }))));
    cards.push(mt);
    const [c7, s7] = card('Equipamentos reincidentes', 'Mais de um incidente no período'); cards.push(c7);
    const [c8, s8] = card('Tendência de degradação — UPS-02', 'Saúde da bateria (série SINTÉTICA de 60 dias) e projeção até 80%'); cards.push(c8);
    const [c9, s9] = card('Incidentes por agência', `${app.agencies.length} agência monitorada`); cards.push(c9);
    body.replaceChildren(...cards.filter(Boolean));
    lineChart(s1, { series: [{ name: 'Disponibilidade', color: '#22c55e', points: s.series.map((p) => ({ t: p.t, v: p.availabilityPct, synthetic: p.synthetic })) }], unit: '%', yMax: 100 });
    lineChart(s2, { series: [{ name: 'Potência', color: '#f59e0b', points: s.series.map((p) => ({ t: p.t, v: p.kw, synthetic: p.synthetic })) }], unit: 'kW', yMin: 0, empty: s.restricted ? 'Medidor em área restrita: visível apenas aos perfis Operador/Administrador.' : 'Sem leitura confiável do medidor no período.' });
    lineChart(s3, { series: [{ name: 'Banda WAN', color: '#38bdf8', points: s.series.map((p) => ({ t: p.t, v: p.wanMbps, synthetic: p.synthetic })) }], unit: 'Mbps', yMin: 0, empty: s.restricted ? 'Roteador em área restrita: visível apenas aos perfis Operador/Administrador.' : 'Sem dados no período.' });
    barChart(s4, Object.entries(s.eventsByCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: app.meta.categories[k]?.label ?? (k === 'simulacao' ? 'Simulação (demo)' : k), value: v, color: CAT_COLORS[k] })));
    timeBars(s5, s.incidentsOverTime, { bucketMs: s.period.bucketMs, since: s.period.since, until: s.period.until });
    barChart(s6, ['critical', 'high', 'medium', 'low'].filter((k) => s.bySeverity[k]).map((k) => ({ label: { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa' }[k], value: s.bySeverity[k], color: SEV_COLORS[k] })));
    barChart(s7, s.recurrent.map((r) => ({ label: r.id, value: r.n, color: '#f97316' })), { empty: 'Nenhuma reincidência no período.' });
    if (!s.upsTrend) { s8.append(h('div', { class: 'locked-box', text: 'Nobreaks em área restrita: visível apenas aos perfis Operador/Administrador.' })); }
    const a = s.upsTrend?.analysis;
    const proj = a?.projection ? [{ t: s.upsTrend.series.at(-1).t + a.projection.daysToThreshold * 86400000, v: a.projection.threshold }] : [];
    if (s.upsTrend) lineChart(s8, { series: [{ name: 'Saúde da bateria', color: '#eab308', points: s.upsTrend.series.map((p) => ({ ...p, synthetic: true })) }, ...(proj.length ? [{ name: 'Projeção linear', color: '#ef4444', points: [{ ...s.upsTrend.series.at(-1) }, ...proj] }] : [])], unit: '%' });
    if (s.upsTrend) s8.append(h('p', { class: 'row-sub', text: a?.projection ? `Inclinação ${a.slopePerDay.toFixed(3)} p.p./dia · R² ${a.r2.toFixed(2)} · ~${Math.round(a.projection.daysToThreshold)} dias até 80%, se a tendência linear se mantiver.` : `Sem projeção: ${a?.reason ?? 'dados insuficientes'}.` }));
    barChart(s9, Object.entries(s.incidentsByAgency).map(([k, v]) => ({ label: app.agencies.find((x) => x.id === k)?.name ?? k, value: v, color: '#22d3ee' })));
    if (s.seriesStart && s.period.since < s.seriesStart) c1.querySelector('.sub').textContent += ` · série disponível desde ${fmtTime(s.seriesStart, true)}`;
  };
  load().catch((e) => toast(e.message, 'critical'));
  app.pageTimer = setInterval(() => { if (document.activeElement?.tagName !== 'SELECT') load().catch(() => {}); }, 10000);
}

// ---------- 3–7. Categorias ----------
function categoryView(app, def, root) {
  const rows = [...app.statics.values()].filter((d) => def.cats.includes(d.category));
  const live = (id) => app.live.devices.get(id);
  const counts = {};
  rows.forEach((d) => { const s = live(d.id)?.status ?? 'unknown'; counts[s] = (counts[s] || 0) + 1; });
  const restrictedHidden = !app.can('read:restricted');
  const table = h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['ID', 'Equipamento', 'Tipo', 'Ambiente', 'Estado', 'Motivo principal', 'Última comunicação'].map((t) => h('th', { text: t })))),
    h('tbody', {}, rows.sort((a, b) => STATUS_ORDER.indexOf(live(a.id)?.status) - STATUS_ORDER.indexOf(live(b.id)?.status) || a.id.localeCompare(b.id)).map((d) => {
      const l = live(d.id);
      return h('tr', { class: 'clickable', tabindex: 0, onclick: () => app.select(d.id), onkeydown: (e) => { if (e.key === 'Enter') app.select(d.id); } },
        h('td', { class: 'mono', text: d.id }), h('td', { text: d.name }), h('td', { text: app.meta.types[d.type].label }),
        h('td', { text: app.layout.rooms.find((r) => r.id === d.room)?.name ?? d.room }),
        h('td', {}, statusBadge(l?.status ?? 'unknown', app.meta.statuses[l?.status ?? 'unknown'].label)),
        h('td', { class: 'row-sub', text: l?.reasons?.[0]?.text ?? '—' }), h('td', { class: 'mono', text: fmtAge(l?.ageMs) }));
    })));
  const extra = h('div', { class: 'grid wide' });
  fillRoot(root, 
    pageHead(def.label, `${rows.length} equipamento(s) visíveis ao seu perfil${restrictedHidden ? ' — itens em áreas restritas ocultos' : ''}.`,
      h('button', { class: 'btn', onclick: () => { app.setCategoryFilter(def.cats); app.go('twin'); } }, 'Ver no Gêmeo 3D')),
    h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, Object.entries(counts).sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0])).map(([s, n]) => h('span', { class: 'card', style: 'padding:6px 10px' }, statusBadge(s, `${app.meta.statuses[s].label}: ${n}`)))),
    extra,
    h('div', { class: 'card', style: 'margin-top:12px' }, h('div', { class: 'tbl-wrap' }, table)));

  if (def.id === 'cftv') {
    const cams = rows.filter((d) => d.type === 'camera');
    const c = h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h2', { text: 'Painel de vídeo' }), h('div', { class: 'sub', text: 'Quadros SINTÉTICOS: nenhuma integração de VMS homologada. Cada abertura é auditada.' }));
    if (!app.can('read:video')) c.append(h('div', { class: 'locked-box', text: 'Acesso ao vídeo restrito aos perfis Operador e Administrador.' }));
    else {
      const grid = h('div', { class: 'cam-grid' });
      c.append(h('button', { class: 'btn', onclick: async (e) => {
        e.target.remove();
        for (const d of cams) {
          try { const v = await api.get(`/api/devices/${d.id}/video`); grid.append(h('button', { class: 'cam-tile', onclick: () => app.select(d.id) }, videoCanvas(d.id, v), h('div', { class: 'row-top' }, h('span', { class: 'mono', text: d.id }), statusBadge(live(d.id).status, app.meta.statuses[live(d.id).status].label)))); } catch { /* sem permissão */ }
        }
      } }, `Abrir mosaico (${cams.length} câmeras, auditado)`), grid);
    }
    extra.append(c);
  }
  if (def.id === 'energia' || def.id === 'rede') {
    const c = h('div', { class: 'card' }, h('h2', { text: def.id === 'energia' ? 'Potência ativa — QDG' : 'Banda WAN' }), h('div', { class: 'sub', text: 'Última hora · tracejado = sintético' }));
    const slot = h('div'); c.append(slot); extra.append(c);
    api.get('/api/metrics/summary?period=1h').then((s) => {
      if (!slot.isConnected) return;
      lineChart(slot, def.id === 'energia'
        ? { series: [{ name: 'Potência', color: '#f59e0b', points: s.series.map((p) => ({ t: p.t, v: p.kw, synthetic: p.synthetic })) }], unit: 'kW', yMin: 0, empty: 'Sem leitura confiável do medidor.' }
        : { series: [{ name: 'Banda WAN', color: '#38bdf8', points: s.series.map((p) => ({ t: p.t, v: p.wanMbps, synthetic: p.synthetic })) }], unit: 'Mbps', yMin: 0 });
    });
    if (def.id === 'energia') {
      const m = live('MTR-01');
      extra.append(h('div', { class: 'card' }, h('h2', { text: 'Granularidade de medição' }),
        h('p', { class: 'row-sub', text: 'Pontos efetivamente medidos nesta agência demonstrativa: QDG (MTR-01) e PDU do rack (PDU-01). Consumo por equipamento individual NÃO é medido — exigiria instrumentação adicional por circuito.' }),
        h('dl', { class: 'kv' }, h('dt', { text: 'Potência agora' }), h('dd', { text: m && !['offline', 'unknown'].includes(m.status) ? fmtValue(m.values.kW, 'kW') : 'sem leitura confiável' }),
          h('dt', { text: 'Consumo hoje' }), h('dd', { text: m ? fmtValue(m.values.kWhToday, 'kWh') : '—' }),
          h('dt', { text: 'Fator de potência' }), h('dd', { text: m ? fmtValue(m.values.pf) : '—' }))));
    }
  }
}

// ---------- 8. Diagnósticos por IA ----------
function aiView(app, root) {
  const dxs = app.live.incidents.filter((i) => i.diagnosis && !i.redacted);
  const log = h('div', { class: 'ai-log' });
  const input = h('input', { maxlength: 500, placeholder: 'Pergunte sobre o estado da agência…', 'aria-label': 'Pergunta ao SENTINEL AI' });
  const form = h('form', { class: 'ai-form', onsubmit: (e) => { e.preventDefault(); app.ask(input.value, log); input.value = ''; } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Enviar'));
  fillRoot(root, 
    pageHead('SENTINEL AI — Motor Cognitivo de Diagnóstico Operacional', 'Diagnósticos derivados de evidências: fatos, hipótese, confiança por critérios, recomendações e incertezas.'),
    h('div', { class: 'grid wide' },
      h('div', { class: 'card' }, h('h2', { text: 'Como o diagnóstico é produzido' }),
        h('ol', { class: 'row-sub' },
          h('li', { text: 'Nível 1 — regras determinísticas por métrica e por idade da telemetria (sem dado recente nunca é "operacional").' }),
          h('li', { text: 'Nível 2 — linha de base por dispositivo (n ≥ 30, |z| > 4) e tendência linear (R² ≥ 0,6) para projeções.' }),
          h('li', { text: 'Correlação — grafo de dependências agrupa sinais e identifica a causa raiz provável, separando relação conhecida de inferida.' }),
          h('li', { text: 'Nível 3 — explicação estruturada por motor determinístico de templates. Integração com LLM está prevista e desativada neste MVP: ela só poderá reescrever o texto, nunca acrescentar fatos.' }))),
      h('section', { class: 'card ai-inline', 'aria-label': 'Assistente operacional' }, h('h2', { text: 'Assistente operacional' }), log, form)),
    h('h2', { style: 'font-size:14px;margin:18px 0 8px', text: `Diagnósticos ativos (${dxs.length})` }),
    dxs.length ? h('div', { class: 'grid wide' }, dxs.map((i) => h('button', { class: 'card row-btn', onclick: () => app.selectIncident(i.id) },
      h('div', { class: 'row-top' }, h('strong', { text: i.diagnosis.title }), sevTag(i.severity)),
      h('div', { class: 'row-sub', text: `Hipótese: ${i.diagnosis.hypothesis}` }),
      h('div', { class: 'row-sub', text: `Confiança: ${i.diagnosis.confidence} · ${i.deviceIds.length} equipamento(s) · ${i.id}` })))) : h('p', { class: 'empty', text: 'Nenhum diagnóstico ativo. Execute um cenário no simulador para observar o motor em ação.' }));
  app.ask('', log, { greet: true });
}

// ---------- 9. Incidentes ----------
function incidentsView(app, root) {
  const f = app.incFilters ??= { status: 'active', severity: '' };
  const body = h('div', { class: 'card' });
  fillRoot(root, pageHead('Incidentes e Alertas', 'Um incidente por grupo correlacionado; alertas duplicados são suprimidos e contabilizados.',
    select('Estado', [['active', 'Ativos'], ['', 'Todos'], ['normalizado', 'Normalizados'], ['resolvido', 'Resolvidos']], f.status, (v) => { f.status = v; incidentsView(app, root); }),
    select('Criticidade', [['', 'Todas'], ['critical', 'Crítica'], ['high', 'Alta'], ['medium', 'Média']], f.severity, (v) => { f.severity = v; incidentsView(app, root); })), body);
  api.get(`/api/incidents?status=${f.status}`).then((list) => {
    list = list.filter((i) => !f.severity || i.severity === f.severity);
    list.forEach((i) => app.incidentCache.set(i.id, i));
    body.replaceChildren(list.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['ID', 'Título', 'Crit.', 'Prior.', 'Estado', 'Criado', 'Detecção', 'Equip.', 'Reconhecido por', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, list.map((i) => h('tr', { class: 'clickable', onclick: () => app.selectIncident(i.id) },
        h('td', { class: 'mono', text: i.id }), h('td', {}, i.title, i.synthetic === 'history' ? h('span', { class: 'pill synthetic', text: 'sintético', style: 'margin-left:6px' }) : null),
        h('td', {}, sevTag(i.severity)), h('td', { text: i.priority }), h('td', { text: i.status }),
        h('td', { class: 'mono', text: fmtTime(i.createdAt, true) }), h('td', { text: i.firstSignalAt ? fmtDur(i.createdAt - i.firstSignalAt) : '—' }),
        h('td', { text: i.deviceIds?.length ?? '—' }), h('td', { text: i.ackBy ?? '—' }),
        h('td', {}, app.can('incident:ack') && !i.ackAt && i.status !== 'resolvido' ? h('button', { class: 'btn small', onclick: async (e) => { e.stopPropagation(); try { await api.post(`/api/incidents/${i.id}/ack`); incidentsView(app, root); } catch (err) { toast(err.message, 'critical'); } } }, 'Reconhecer') : null)))))) : h('p', { class: 'empty', text: 'Nenhum incidente para os filtros selecionados.' }));
  }).catch((e) => toast(e.message, 'critical'));
}

// ---------- 10. Histórico ----------
function historyView(app, root) {
  const f = app.histFilters ??= { category: '' };
  const body = h('div', { class: 'card' });
  fillRoot(root, pageHead('Histórico e Relatórios', 'Eventos persistidos (retenção configurável) e relatórios técnicos derivados dos registros.',
    select('Categoria', [['', 'Todas'], ...Object.entries(app.meta.categories).map(([k, v]) => [k, v.label]), ['simulacao', 'Simulação']], f.category, (v) => { f.category = v; historyView(app, root); }),
    h('button', { class: 'btn', onclick: () => download('/api/reports/incidents?period=today').catch((e) => toast(e.message, 'critical')) }, 'Relatório de hoje (.md)'),
    h('button', { class: 'btn', onclick: () => download('/api/reports/incidents?period=7d').catch((e) => toast(e.message, 'critical')) }, 'Relatório 7 dias (.md)')), body);
  api.get(`/api/events?limit=300&category=${f.category}`).then((list) => {
    body.replaceChildren(list.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['Horário', 'Tipo', 'Severidade', 'Categoria', 'Equipamento', 'Descrição'].map((t) => h('th', { text: t })))),
      h('tbody', {}, list.map((e) => h('tr', { class: e.deviceId ? 'clickable' : '', onclick: () => e.incidentId ? app.selectIncident(e.incidentId) : e.deviceId && app.select(e.deviceId) },
        h('td', { class: 'mono', text: fmtTime(e.ts, true) }), h('td', { class: 'mono', text: e.type }), h('td', {}, sevTag(e.severity)),
        h('td', { text: app.meta.categories[e.category]?.label ?? e.category }), h('td', { class: 'mono', text: e.deviceId ?? '—' }), h('td', { text: e.text })))))) : h('p', { class: 'empty', text: 'Nenhum evento registrado.' }));
  });
}

// ---------- 11. Integrações ----------
function integrationsView(app, root) {
  const body = h('div', { class: 'card' });
  fillRoot(root, pageHead('Integrações e Conectores', 'Protocolos são possibilidades arquiteturais a homologar por fabricante/modelo. Nenhum equipamento real está conectado.'), body,
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', { text: 'Contrato de ingestão (gateway supervisionado → plataforma)' }),
      h('div', { class: 'sub', text: 'POST /api/ingest · Authorization: Bearer <token do gateway> · somente leitura · detalhes em docs/CONTRATOS.md' }),
      h('pre', { class: 'mono', style: 'white-space:pre-wrap;margin:0;color:#c9d4e2', text: JSON.stringify({ readings: [{ deviceId: 'TH-01', sourceTs: 1767225600000, values: { tempC: 23.4, humidityPct: 47 }, quality: 'good' }] }, null, 2) })));
  api.get('/api/connectors').then((list) => body.replaceChildren(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['Conector', 'Domínio', 'Protocolo', 'Estado', 'Dados disponíveis', 'Autenticação', 'Frequência', 'Limitações', 'Falhas', 'Segurança'].map((t) => h('th', { text: t })))),
    h('tbody', {}, list.map((c) => h('tr', {},
      h('td', { class: 'mono', text: c.id }), h('td', { text: c.domain }), h('td', { text: c.protocol }),
      h('td', {}, h('span', { class: `pill ${c.runtimeStatus === 'ativo' ? '' : 'synthetic'}`, text: c.runtimeStatus }), c.stats ? h('div', { class: 'row-sub', text: `${c.stats.received} aceitas · ${c.stats.rejected} rejeitadas` }) : null),
      h('td', { text: c.data }), h('td', { text: c.auth }), h('td', { text: c.frequency }), h('td', { text: c.limitations }), h('td', { text: c.failure }), h('td', { text: c.security }))))))));
}

// ---------- 12. Administração ----------
function adminView(app, root) {
  const PERMS = ['read:twin', 'read:incidents', 'read:restricted', 'read:sensitive', 'read:video', 'incident:ack', 'incident:resolve', 'device:maintenance', 'scenario:run', 'assistant:use', 'admin:audit', 'admin:config'];
  const ROLE_PERMS = { observador: ['read:twin', 'read:incidents'], operador: PERMS.slice(0, 10), administrador: PERMS };
  const audit = h('div', { class: 'card', style: 'margin-top:12px' });
  const cfg = h('div', { class: 'card' });
  fillRoot(root, 
    pageHead('Administração e Governança', 'Controle de acesso por perfil, auditoria e retenção. Em produção: IdP corporativo com MFA (OIDC/SAML).'),
    h('div', { class: 'grid wide' },
      h('div', { class: 'card' }, h('h2', { text: 'Sessão atual' }), h('dl', { class: 'kv' }, h('dt', { text: 'Usuário' }), h('dd', { text: app.me.user }), h('dt', { text: 'Perfil' }), h('dd', { text: app.me.roleLabel }), h('dt', { text: 'Autenticação' }), h('dd', { text: 'Demonstração (sem IdP)' }))),
      cfg),
    h('div', { class: 'card', style: 'margin-top:12px' }, h('h2', { text: 'Matriz de permissões (RBAC)' }), h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Permissão' }), Object.values(app.meta.roles).map((r) => h('th', { text: r })))),
      h('tbody', {}, PERMS.map((p) => h('tr', {}, h('td', { class: 'mono', text: p }), Object.keys(app.meta.roles).map((r) => h('td', { text: ROLE_PERMS[r].includes(p) ? '✔' : '—' })))))))),
    audit);
  if (!app.can('admin:config')) cfg.append(h('h2', { text: 'Retenção de telemetria' }), h('div', { class: 'locked-box', text: 'Configuração restrita ao perfil Administrador.' }));
  else api.get('/api/admin/config').then((c) => {
    const inp = h('input', { type: 'number', min: 1, max: 3650, value: c.retentionDays, style: 'width:90px' });
    cfg.append(h('h2', { text: 'Retenção de eventos' }), h('div', { class: 'sub', text: 'Eventos mais antigos que o limite são removidos do armazenamento.' }),
      h('div', { class: 'toolbar' }, h('label', {}, 'Dias', inp), h('button', { class: 'btn', onclick: async () => { try { const r = await api.put('/api/admin/config', { retentionDays: Number(inp.value) }); toast(`Retenção: ${r.retentionDays} dias · ${r.eventsKept} eventos mantidos`); } catch (e) { toast(e.message, 'critical'); } } }, 'Salvar')));
  });
  if (!app.can('admin:audit')) audit.append(h('h2', { text: 'Trilha de auditoria' }), h('div', { class: 'locked-box', text: 'Auditoria visível apenas ao perfil Administrador.' }));
  else api.get('/api/admin/audit').then((list) => audit.append(h('h2', { text: `Trilha de auditoria (${list.length} mais recentes)` }), h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, ['Horário', 'Usuário', 'Perfil', 'Ação', 'Alvo'].map((t) => h('th', { text: t })))),
    h('tbody', {}, list.map((a) => h('tr', {}, h('td', { class: 'mono', text: fmtTime(a.ts, true) }), h('td', { text: a.user }), h('td', { text: a.role ?? '—' }), h('td', { class: 'mono', text: a.action }), h('td', { class: 'mono', text: a.target ?? '' }))))))));
}
