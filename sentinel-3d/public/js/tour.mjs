// Modo Apresentação: tour guiado que ilustra as funcionalidades da plataforma em sequência.
// Cada passo executa ações reais da interface (navegação, cenários, camadas) — nada é encenado:
// os incidentes e diagnósticos exibidos são produzidos pelo motor a partir da telemetria simulada.

import { api } from './api.mjs';
import { h, toast } from './util.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Aguarda um incidente ativo que envolva o equipamento (o motor precisa detectar e confirmar). */
async function waitIncident(app, deviceId, timeoutMs, isActive, kind) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && isActive()) {
    const inc = app.live.incidents.find((i) => i.deviceIds?.includes(deviceId) && i.status !== 'normalizado' && (!kind || i.kind === kind));
    if (inc) return inc;
    await sleep(500);
  }
  return null;
}

const pressed = (sel, on) => { const b = document.querySelector(sel); if (b && (b.getAttribute('aria-pressed') === 'true') !== on) b.click(); };

async function scenarios(app, start = []) {
  if (app.live.scenarios.length) await api.post('/api/scenarios/all/stop');
  for (const id of start) await api.post(`/api/scenarios/${id}/start`);
}

function steps(app) {
  const showIncident = async (ctx, deviceId, timeoutMs, kind) => {
    ctx.status('Aguardando o motor detectar e correlacionar…');
    const inc = await waitIncident(app, deviceId, timeoutMs, ctx.active, kind);
    if (!ctx.active()) return;
    if (inc) { app.selectIncident(inc.id); app.focus(inc.rootDeviceId); ctx.status(`Incidente ${inc.id} · confiança ${inc.diagnosis?.confidence ?? '—'}`); }
    else ctx.status('O incidente ainda está na janela de confirmação; avance quando aparecer.');
  };
  return [
    {
      title: 'Gêmeo digital da agência',
      text: 'Agência demonstrativa em 3D, com a planta do mapa de ativos (ambientes 01–08). Cada um dos 53 equipamentos é um objeto selecionável, ligado ao inventário e à telemetria. À direita, o mapa de ativos mostra o status ao vivo.',
      run: async () => { await scenarios(app); app.clearSelection(); app.setMode('aerial'); pressed('#t-metrics', false); pressed('#t-deps', false); },
    },
    {
      title: '06 · Suporte Técnico',
      text: 'Racks de rede, CFTV e servidores, nobreaks, quadro elétrico e climatização. Os marcadores usam cor, forma e ícone: o estado nunca depende só da cor.',
      run: async () => { app.flyToRoom('suporte'); },
    },
    {
      title: 'Desempenho em tempo real',
      text: 'A camada Desempenho mostra o indicador principal de cada equipamento: fps das câmeras, latência e banda dos links, CPU e temperatura dos servidores, carga do nobreak, kW do quadro.',
      run: async () => { pressed('#t-metrics', true); app.setMode('aerial'); },
    },
    {
      title: 'Cenário A · Câmera sem vídeo',
      text: 'A CAM-018 continua respondendo à rede, mas o vídeo para. A regra não a considera operacional: falha crítica, com hipótese local e confiança média, explicada por critérios.',
      run: async (ctx) => { pressed('#t-metrics', false); await scenarios(app, ['A']); await showIncident(ctx, 'CAM-018', 15000); },
    },
    {
      title: 'Cenário B · Falha em switch (correlação)',
      text: 'O SW-03 cai e 3 câmeras param de reportar. Em vez de 4 alarmes, o motor abre um único incidente com a causa raiz provável. As câmeras ficam roxas: "sem dados", não "com defeito".',
      run: async (ctx) => { await scenarios(app, ['B']); app.setMode('xray'); pressed('#t-deps', true); await showIncident(ctx, 'SW-03', 20000, 'cascade'); },
    },
    {
      title: 'Cenário G · Queda do link principal',
      text: 'O link WAN principal cai; o 4G assume o tráfego com latência maior. A redundância mantém a rede, e o surto de banda no 4G é tratado como consequência, não como um novo problema.',
      run: async (ctx) => { pressed('#t-deps', false); app.setMode('aerial'); await scenarios(app, ['G']); pressed('#t-metrics', true); await showIncident(ctx, 'RTR-01', 25000, 'failover'); },
    },
    {
      title: 'Cenário H · Degradação térmica',
      text: 'A climatização perde rendimento e as temperaturas sobem aos poucos. O motor acompanha a progressão e agrupa tudo num único incidente térmico, com a climatização como causa provável.',
      run: async (ctx) => { await scenarios(app, ['H']); app.focus('HVAC-01'); await showIncident(ctx, 'HVAC-01', 50000, 'thermal'); },
    },
    {
      title: 'Cenário D · Alarme de incêndio',
      text: 'A central reporta alarme na Recepção: região destacada, prioridade P1 e protocolo de escalonamento. A plataforma não executa nenhum comando físico e exige confirmação humana.',
      run: async (ctx) => { pressed('#t-metrics', false); await scenarios(app, ['D']); await showIncident(ctx, 'SD-04', 15000, 'fire'); },
    },
    {
      title: 'Assistente SENTINEL AI',
      text: 'O operador pergunta em linguagem natural. As respostas vêm de ferramentas tipadas sobre os dados que o perfil dele pode ver, com fatos, hipótese, confiança e incertezas separados.',
      run: async () => {
        const drawer = document.getElementById('ai-drawer');
        if (drawer.hidden) document.getElementById('btn-ai').click();
        await sleep(400);
        app.ask('Qual a provável causa da falha das câmeras da recepção?', document.getElementById('ai-log'));
      },
    },
    {
      title: 'Primeira pessoa',
      text: 'Entre na agência e caminhe pelos ambientes (clique na cena, W A S D para andar, Esc para sair). Paredes e móveis têm colisão; clicar num equipamento abre o painel dele.',
      run: async () => { const d = document.getElementById('ai-drawer'); if (!d.hidden) document.getElementById('ai-close').click(); app.setMode('fpv'); },
    },
    {
      title: 'Pronto para integrar',
      text: 'Fim do tour. Os mesmos fluxos funcionam com telemetria real no modo integração (sem simulador), alimentado por gateway autenticado. Encerrei os cenários; explore à vontade.',
      run: async () => { await scenarios(app); app.clearSelection(); app.setMode('aerial'); },
    },
  ];
}

export function startTour(app) {
  if (document.getElementById('tour')) return;
  const list = steps(app);
  let i = 0, auto = false, token = 0, timer = null;
  const statusEl = h('p', { class: 'tour-status', 'aria-live': 'polite' });
  const titleEl = h('h2', { id: 'tour-title' });
  const textEl = h('p', { class: 'tour-text' });
  const counter = h('span', { class: 'tour-count' });
  const bar = h('div', { class: 'tour-bar' }, h('i'));
  const prev = h('button', { class: 'btn', type: 'button', onclick: () => go(i - 1) }, '◀ Anterior');
  const next = h('button', { class: 'btn primary', type: 'button' }, 'Próximo ▶'); // handler único, definido em go()
  const play = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => { auto = !auto; play.setAttribute('aria-pressed', auto); play.textContent = auto ? '❚❚ Pausar' : '▶ Automático'; if (auto) schedule(); else clearTimeout(timer); } }, '▶ Automático');
  const close = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Sair da apresentação', onclick: () => end() }, '✕');
  const card = h('section', { id: 'tour', class: 'tour', role: 'dialog', 'aria-labelledby': 'tour-title' },
    h('div', { class: 'tour-head' }, h('span', { class: 'tour-kicker', text: 'MODO APRESENTAÇÃO' }), counter, close),
    titleEl, textEl, statusEl, bar, h('div', { class: 'tour-actions' }, prev, play, next));
  document.body.append(card);

  const schedule = () => { clearTimeout(timer); if (auto && i < list.length - 1) timer = setTimeout(() => go(i + 1), 14000); };

  async function go(n) {
    if (n < 0 || n >= list.length) return;
    i = n; const my = ++token;
    const s = list[i];
    titleEl.textContent = s.title; textEl.textContent = s.text; statusEl.textContent = '';
    counter.textContent = `${i + 1} / ${list.length}`;
    bar.firstChild.style.width = `${((i + 1) / list.length) * 100}%`;
    prev.disabled = i === 0; next.textContent = i === list.length - 1 ? 'Concluir' : 'Próximo ▶';
    next.onclick = i === list.length - 1 ? () => end() : () => go(i + 1);
    clearTimeout(timer);
    try {
      await s.run({ active: () => my === token, status: (t) => { if (my === token) statusEl.textContent = t; } });
    } catch (e) { if (my === token) statusEl.textContent = `Não foi possível executar este passo: ${e.message}`; }
    if (my === token) schedule();
  }

  function end() {
    token += 1; clearTimeout(timer); card.remove();
    api.post('/api/scenarios/all/stop').catch(() => {});
    toast('Apresentação encerrada. Cenários finalizados.');
  }

  addEventListener('keydown', function onKey(e) {
    if (!document.getElementById('tour')) return removeEventListener('keydown', onKey);
    if (e.target.closest?.('input,textarea,select')) return;
    if (e.key === 'ArrowRight' && app.mode !== 'fpv') go(i + 1);
    if (e.key === 'ArrowLeft' && app.mode !== 'fpv') go(i - 1);
  });
  if (!app.can('scenario:run')) toast('Seu perfil não pode executar cenários; a apresentação mostrará só a navegação.', 'high');
  go(0);
}
