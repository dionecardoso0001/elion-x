// SENTINEL 3D — inicialização e estado da aplicação.

import { api, connectStream } from './api.mjs';
import { h, $, statusBadge, statusIcon, fmtTime, toast, throttle, STATUS_ORDER } from './util.mjs';
import { renderPanel } from './panel.mjs';
import { MENU, renderView } from './views.mjs';
import { Plan2D } from './twin/plan2d.mjs';

const app = {
  meta: null, me: null, layout: null, agencies: [], statics: new Map(), deps: [],
  live: { devices: new Map(), incidents: [], kpis: null, scenarios: [] },
  selected: null, view: 'twin', mode: 'aerial', incidentCache: new Map(),
  filters: { categories: null, statuses: null },
  scene: null, plan: null, es: null, pageTimer: null,
  can: (perm) => app.me?.perms.includes(perm),
};

// ---------- ações globais ----------
app.select = (id) => {
  app.selected = { type: 'device', id };
  app.scene?.select(id); app.plan?.select(id); app.scene?.highlightIncident(null);
  renderPanel(app, { force: true });
};
app.selectIncident = (id) => {
  app.selected = { type: 'incident', id };
  const inc = app.live.incidents.find((i) => i.id === id) || app.incidentCache.get(id);
  app.scene?.select(inc?.rootDeviceId ?? null);
  renderPanel(app, { force: true });
};
app.clearSelection = () => { app.selected = null; app.scene?.select(null); app.scene?.highlightIncident(null); app.plan?.select(null); renderPanel(app, { force: true }); };
app.focus = (id) => {
  if (!app.statics.has(id)) return toast(`${id} não está visível para o seu perfil.`, 'high');
  if (app.view !== 'twin') app.go('twin');
  if (app.mode === 'plan' || !app.scene) { app.plan?.select(id); return; }
  app.scene.flyTo(id);
  app.scene.select(id);
};
app.go = (view) => {
  app.view = view;
  clearInterval(app.pageTimer);
  for (const b of document.querySelectorAll('#menu button')) b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');
  const twin = view === 'twin';
  $('#view-twin').hidden = !twin;
  $('#view-page').hidden = twin;
  app.scene?.setVisible(twin && app.mode !== 'plan');
  if (!twin) renderView(app, view, $('#view-page'));
  else app.scene?.resize();
};
app.flyToRoom = (id) => {
  if (app.view !== 'twin') app.go('twin');
  if (app.mode === 'plan' || !app.scene) return;
  app.scene.flyToRoom(id);
};
app.setCategoryFilter = (cats) => {
  for (const inp of document.querySelectorAll('#f-category input')) inp.checked = cats.includes(inp.value);
  applyFilters();
};

// ---------- assistente ----------
app.ask = async (q, log, { greet } = {}) => {
  const add = (cls, ...kids) => { const m = h('div', { class: `msg ${cls}` }, ...kids); log.append(m); log.scrollTop = log.scrollHeight; return m; };
  if (greet) { q = 'ajuda'; } else { if (!q.trim()) return; add('user', q); }
  if (!app.can('assistant:use')) return add('bot', 'Seu perfil não tem acesso ao assistente operacional.');
  try {
    const r = await api.post('/api/assistant', { q });
    const m = add('bot', h('div', { text: r.text }));
    if (r.items?.length) m.append(h('ul', {}, r.items.map((it) => h('li', {},
      it.suggestion ? h('button', { class: 'sugg', type: 'button', onclick: () => app.ask(it.label, log), text: it.label })
        : h('span', {}, it.status ? statusBadge(it.status, '') : null, ' ', it.deviceId || it.incidentId ? h('button', { class: 'sugg', type: 'button', onclick: () => (it.incidentId ? app.selectIncident(it.incidentId) : app.select(it.deviceId)), text: it.label }) : it.label, it.detail ? ` — ${it.detail}` : '')))));
    if (r.diagnosis) {
      const d = r.diagnosis;
      m.append(h('div', { class: 'dx', style: 'margin-top:6px' },
        h('div', { class: 'dx-block' }, h('h4', { text: 'Evidências' }), h('ul', {}, d.facts.map((f) => h('li', { text: f })))),
        h('div', { class: 'dx-block hyp' }, h('h4', { text: 'Hipótese técnica' }), h('p', { text: d.hypothesis })),
        h('div', { class: 'dx-block' }, h('h4', { text: `Confiança: ${d.confidence}` }), h('ul', {}, d.confidenceCriteria.map((c) => h('li', { text: c })))),
        h('div', { class: 'dx-block' }, h('h4', { text: 'Ação recomendada' }), h('ul', {}, d.recommendations.map((c) => h('li', { text: c })))),
        h('div', { class: 'dx-block' }, h('h4', { text: `Prioridade: ${d.priority}` }), h('ul', {}, d.uncertainties.map((c) => h('li', { text: `Incerteza: ${c}` }))))));
    }
    if (r.note) m.append(h('p', { class: 'row-sub', text: r.note }));
    for (const a of r.actions || []) {
      if (a.type === 'focus') { m.append(h('button', { class: 'btn small', type: 'button', onclick: () => app.focus(a.deviceId), text: a.label })); if (a.auto) app.focus(a.deviceId); }
      if (a.type === 'download') m.append(h('a', { class: 'btn small', href: a.href, download: '', text: a.label }));
    }
    m.append(h('div', { class: 'src', text: `${r.tool} · ${r.source}` }));
  } catch (e) { add('bot', `Erro: ${e.message}`); }
};

// ---------- renderização do estado ----------
function renderKpis() {
  const k = app.live.kpis;
  if (!k) return;
  const item = (label, value, cls = '') => h('li', { class: `kpi ${cls}` }, h('b', { text: value }), h('span', { text: label }));
  $('#kpis').replaceChildren(
    item('Agências', k.agencies), item('Dispositivos', k.devices), item('Operacionais', k.ok, 'ok'),
    item('Instáveis', k.degraded, k.degraded ? 'warn' : ''), item('Falhas críticas', k.critical, k.critical ? 'crit' : ''),
    item('Sem comunicação', k.noComm, k.noComm ? 'off' : ''), item('Incidentes abertos', k.openIncidents, k.openIncidents ? 'crit' : ''),
    item('Energia medida', k.kw == null ? '—' : `${k.kw.toFixed(1)} kW`), item('Conectores ativos', `${k.connectors.up}/${k.connectors.total}`),
    item('Atualizado', fmtTime(k.lastUpdate)));
  const badge = document.querySelector('#menu [data-view=incidents] .badge');
  if (badge) { badge.textContent = k.openIncidents; badge.classList.toggle('zero', !k.openIncidents); }
}

function renderScenarios() {
  const active = new Set(app.live.scenarios);
  const can = app.can('scenario:run');
  for (const li of document.querySelectorAll('#scenarios .scenario')) {
    const on = active.has(li.dataset.id);
    li.classList.toggle('active', on);
    const b = li.querySelector('button');
    b.textContent = on ? 'Encerrar' : 'Iniciar';
    b.className = `btn small ${on ? 'danger' : ''}`;
    b.disabled = !can;
    b.setAttribute('aria-pressed', on);
  }
  $('#sc-reset').disabled = !can || !active.size;
}

const refreshTimeline = throttle(async () => {
  try {
    const evs = await api.get('/api/events?limit=40');
    $('#timeline').replaceChildren(...evs.map((e) => h('li', {}, h('button', { class: `tl-${e.severity}`, title: e.text, onclick: () => (e.incidentId ? app.selectIncident(e.incidentId) : e.deviceId ? app.focus(e.deviceId) || app.select(e.deviceId) : null) },
      h('span', { class: 't', text: `${fmtTime(e.ts)} · ${e.type}` }), h('span', { class: 'x', text: e.text })))));
  } catch { /* stream continua */ }
}, 2500);

const refreshPanelThrottled = throttle(() => renderPanel(app), 2000);
const refreshPage = throttle(() => { if (app.view !== 'twin' && !['overview', 'history', 'integrations', 'admin', 'incidents'].includes(app.view) && !document.querySelector('#view-page :focus')) renderView(app, app.view, $('#view-page')); }, 3000);

function applySnapshot(s) {
  app.live.kpis = s.kpis;
  app.live.scenarios = s.scenarios;
  app.live.devices = new Map(s.devices.map((d) => [d.id, d]));
  app.live.incidents = s.incidents;
  app.lastStates = s.devices;
  app.scene?.setStates(s.devices, s.incidents);
  app.plan?.setStates(s.devices);
  renderKpis(); renderScenarios(); refreshTimeline(); refreshPanelThrottled(); refreshPage();
  // incidente selecionado: atualizar destaque 3D
  if (app.selected?.type === 'incident') { const inc = s.incidents.find((i) => i.id === app.selected.id); if (inc) app.scene?.highlightIncident(inc); }
}

// ---------- filtros ----------
function buildFilters() {
  const cat = $('#f-category'); cat.querySelectorAll('label').forEach((l) => l.remove());
  for (const [k, v] of Object.entries(app.meta.categories)) cat.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: k, checked: true, onchange: applyFilters }), v.label));
  const st = $('#f-status'); st.querySelectorAll('label').forEach((l) => l.remove());
  for (const k of STATUS_ORDER) st.append(h('label', { class: `chk s-${k}` }, h('input', { type: 'checkbox', value: k, checked: true, onchange: applyFilters }), statusIcon(k), h('span', { text: app.meta.statuses[k].label, style: 'color:var(--text)' })));
}

function applyFilters() {
  const pick = (sel) => { const all = [...document.querySelectorAll(`${sel} input`)]; const on = all.filter((i) => i.checked).map((i) => i.value); return on.length === all.length ? null : new Set(on); };
  app.filters = { categories: pick('#f-category'), statuses: pick('#f-status') };
  app.scene?.setFilters(app.filters);
}

// ---------- modos ----------
function setMode(mode) {
  app.mode = mode;
  for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-pressed', b.dataset.mode === mode);
  const plan = mode === 'plan';
  $('#plan2d').hidden = !plan;
  $('#twin-canvas').style.visibility = plan ? 'hidden' : 'visible';
  $('#fpv-hint').hidden = mode !== 'fpv';
  $('#crosshair').hidden = true;
  if (app.scene) { app.scene.setVisible(!plan); if (!plan) app.scene.setMode(mode); app.scene.labelRenderer.domElement.style.display = plan ? 'none' : ''; }
}

// ---------- inicialização ----------
async function loadAll() {
  [app.me, app.meta, app.agencies] = await Promise.all([api.get('/api/me'), api.get('/api/meta'), api.get('/api/agencies')]);
  app.layout = await api.get(`/api/agencies/${app.agencies[0].id}/layout`);
  const [devices, deps] = await Promise.all([api.get('/api/devices'), api.get('/api/dependencies')]);
  app.statics = new Map(devices.map((d) => [d.id, d]));
  app.deps = deps;
  $('#agency').replaceChildren(...app.agencies.map((a) => h('option', { value: a.id, text: `${a.name}${a.demo ? ' (demo)' : ''}` })));
  $('#disclaimer').textContent = app.layout.disclaimer;
  const hideRestricted = !app.can('read:restricted');

  // 3D (com fallback 2D quando não há WebGL)
  const wrap = $('#canvas-wrap');
  app.scene?.dispose();
  app.scene = null;
  const { webglSupported, TwinScene } = await import('./twin/scene.mjs').catch(() => ({ webglSupported: () => false }));
  $('#vr-slot').replaceChildren();
  const canvas = $('#twin-canvas');
  if (webglSupported()) {
    const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh); // nova cena ⇒ novo contexto
    app.scene = new TwinScene({ canvas: fresh, wrap, vrSlot: $('#vr-slot'), onSelect: (id) => app.select(id), onFps: (f) => { $('#fps').textContent = `${f} fps medidos`; } });
    app.scene.onLockChange = (locked) => { $('#crosshair').hidden = !locked; $('#fpv-hint').hidden = locked || app.mode !== 'fpv'; };
    const brand = await api.get('/api/brand').catch(() => ({}));
    await app.scene.build(app.layout, devices, deps, { hideRestricted, logoUrl: brand.logo ?? null });
    app.scene.toggleMetrics($('#t-metrics').getAttribute('aria-pressed') === 'true');
  } else {
    toast('WebGL indisponível: exibindo a planta 2D (modo simplificado).', 'high');
    for (const b of document.querySelectorAll('#modes button')) if (b.dataset.mode !== 'plan') b.disabled = true;
    $('#fps').textContent = 'WebGL indisponível';
  }
  app.plan = new Plan2D($('#plan2d'), { onSelect: (id) => app.select(id), statusLabels: Object.fromEntries(Object.entries(app.meta.statuses).map(([k, v]) => [k, v.label])) });
  app.plan.build(app.layout, devices, { hideRestricted });
  setMode(app.scene ? 'aerial' : 'plan');
  buildFilters(); applyFilters();

  $('#legend').replaceChildren(...STATUS_ORDER.map((s) => statusBadge(s, app.meta.statuses[s].label)));

  // simulador
  const sc = await api.get('/api/scenarios');
  $('#scenarios').replaceChildren(...sc.scenarios.map((s) => h('li', { class: 'scenario', dataset: { id: s.id } },
    h('div', { class: 'scenario-head' }, h('b', { text: `${s.id} · ${s.label}` }), h('button', { class: 'btn small', onclick: () => toggleScenario(s.id) }, 'Iniciar')),
    h('p', { text: s.description }))));

  app.es?.close();
  app.es = connectStream({
    onSnapshot: applySnapshot, onUpdate: applySnapshot,
    onNotify: (n) => toast(n.text, n.level, () => (n.incidentId ? app.selectIncident(n.incidentId) : null)),
    onState: (st) => { if (st === 'reconectando') $('#fps').title = 'Conexão com o servidor: reconectando…'; },
  });
  app.clearSelection();
  app.go(app.view);
}

async function toggleScenario(id) {
  const on = app.live.scenarios.includes(id);
  try {
    await api.post(`/api/scenarios/${id}/${on ? 'stop' : 'start'}`);
    if (!on) {
      toast(`MODO DEMONSTRAÇÃO — cenário ${id} iniciado. Aguarde a detecção (alguns segundos).`, 'info');
      const target = { A: 'CAM-018', B: 'SW-03', C: 'MTR-01', D: 'SD-04', E: 'GW-IOT-01', F: 'CAM-020', G: 'RTR-01', H: 'HVAC-01' }[id];
      // tempo típico até o incidente existir (detecção + janela de confirmação)
      const wait = { A: 6500, B: 9000, C: 4000, D: 4000, E: 9000, F: 17000, G: 17000, H: 30000 }[id];
      if (id === 'H') setTimeout(() => app.focus('HVAC-01'), 1500);
      setTimeout(() => { const inc = app.live.incidents.find((i) => i.deviceIds?.includes(target)); if (inc) { app.selectIncident(inc.id); app.focus(inc.rootDeviceId); } else app.focus(target); }, wait);
    }
  } catch (e) { toast(e.message, 'critical'); }
}

/** Garante sessão de demonstração com o perfil desejado (padrão: operador). */
async function ensureSession(role) {
  const s = await api.get('/api/session');
  if (s.authenticated && (!role || s.role === role)) return;
  await api.post('/api/session', { role: role || 'operador' });
}

async function boot() {
  $('#menu').replaceChildren(...MENU.map((m, i) => h('li', {}, h('button', { dataset: { view: m.id }, onclick: () => app.go(m.id) },
    h('span', { class: 'n', text: String(i + 1).padStart(2, '0') }), h('span', { text: m.label }), m.id === 'incidents' ? h('span', { class: 'badge zero', text: '0' }) : null))));
  for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => { if (app.view !== 'twin') app.go('twin'); setMode(b.dataset.mode); });
  const toggle = (id, fn) => $(id).addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); fn(on); });
  toggle('#t-deps', (on) => app.scene?.toggleDeps(on));
  toggle('#t-labels', (on) => app.scene?.toggleLabels(on));
  toggle('#t-metrics', (on) => app.scene?.toggleMetrics(on, app.lastStates));
  toggle('#t-expand', (on) => { document.body.classList.toggle('expanded', on); setTimeout(() => app.scene?.resize(), 240); });
  $('#sc-reset').addEventListener('click', async () => { try { await api.post('/api/scenarios/all/stop'); toast('Todos os cenários encerrados.'); } catch (e) { toast(e.message, 'critical'); } });
  const drawer = $('#ai-drawer');
  const setDrawer = (open) => { drawer.hidden = !open; $('#btn-ai').setAttribute('aria-expanded', open); if (open) { if (!$('#ai-log').childElementCount) app.ask('', $('#ai-log'), { greet: true }); $('#ai-input').focus(); } };
  $('#btn-ai').addEventListener('click', () => setDrawer(drawer.hidden));
  $('#ai-close').addEventListener('click', () => setDrawer(false));
  $('#ai-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#ai-input'); app.ask(i.value, $('#ai-log')); i.value = ''; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) setDrawer(false); });

  let saved = null;
  try { saved = localStorage.getItem('sentinel.role'); } catch { /* armazenamento indisponível */ }
  await ensureSession(saved);
  const roles = (await api.get('/api/meta')).roles;
  app.me = await api.get('/api/me');
  $('#role').replaceChildren(...Object.entries(roles).map(([k, v]) => h('option', { value: k, text: v, selected: k === app.me.role || null })));
  $('#role').addEventListener('change', async (e) => {
    await api.post('/api/session', { role: e.target.value });
    try { localStorage.setItem('sentinel.role', e.target.value); } catch { /* ignore */ }
    toast(`Perfil alterado para ${roles[e.target.value]}.`);
    await loadAll();
  });
  await loadAll();
}

boot().catch((e) => { console.error(e); toast(`Falha ao iniciar: ${e.message}`, 'critical'); });
