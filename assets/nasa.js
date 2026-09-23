/* ═══════════════════════════════════════════════════════════════════
   ELION-X — MODO NASA
   Console orbital de espectro. Abre a plataforma SIGNAL-X embutida e
   mostra o RASTREIO da varredura das antenas licenciadas na ANATEL.

   Este arquivo é autossuficiente de propósito: injeta o próprio CSS e o
   próprio DOM. Nada em app.css nem na estrutura do index.html precisa
   mudar para o modo NASA existir — e nada do que o ELION-X já faz corre
   risco quando ele for alterado.
═══════════════════════════════════════════════════════════════════ */
(function () {
  const $ = id => document.getElementById(id);

  /* SIGNAL-X roda como serviço próprio. O servidor manda a URL certa no
     payload; isto aqui é só o padrão de desenvolvimento. */
  const PADRAO = 'http://localhost:4477';
  let base = PADRAO;

  /* ── CSS próprio, escopado em #nasaWrap ─────────────────────────── */
  const css = `
#nasaWrap{position:fixed;inset:0;z-index:9200;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .32s ease}
#nasaWrap.on{opacity:1}
#nasaWrap[hidden]{display:none}
#nasaBackdrop{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(4,10,20,.82),rgba(2,4,8,.96));backdrop-filter:blur(6px)}
#nasaSet{position:relative;width:min(1520px,96vw);height:min(880px,92vh);display:flex;flex-direction:column;
  border:1px solid rgba(0,229,255,.28);border-radius:14px;overflow:hidden;background:#05070c;
  box-shadow:0 0 0 1px rgba(0,0,0,.6),0 40px 120px -30px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.06);
  transform:scale(.97);transition:transform .32s cubic-bezier(.22,1,.36,1)}
#nasaWrap.on #nasaSet{transform:scale(1)}
.nasa-head{display:flex;align-items:center;gap:14px;padding:10px 14px;background:linear-gradient(180deg,rgba(10,18,30,.98),rgba(6,10,18,.98));border-bottom:1px solid rgba(0,229,255,.18)}
.nasa-badge{font-family:Orbitron,sans-serif;font-weight:900;font-size:13px;letter-spacing:.22em;color:#0b1220;background:#00e5ff;padding:5px 11px;border-radius:5px}
.nasa-tit{font-family:Orbitron,sans-serif;font-size:11px;letter-spacing:.2em;color:#9fb6cc}
.nasa-alvo{margin-left:auto;font-family:'Share Tech Mono',monospace;font-size:12px;color:#00e5ff;
  max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nasa-x{background:transparent;border:1px solid rgba(255,255,255,.16);color:#9fb6cc;border-radius:6px;
  width:28px;height:26px;cursor:pointer;font-size:13px;line-height:1;transition:.18s}
.nasa-x:hover{color:#fff;border-color:rgba(255,80,110,.6);background:rgba(255,80,110,.12)}
.nasa-body{flex:1;display:flex;min-height:0}
.nasa-frame{flex:1;border:0;background:#05070c}
.nasa-rast{width:310px;flex-shrink:0;border-left:1px solid rgba(255,255,255,.08);
  background:rgba(6,10,17,.96);overflow-y:auto;padding:14px}
.nasa-rot{font-family:Orbitron,sans-serif;font-size:9px;letter-spacing:.2em;color:#5f7590;margin:0 0 8px}
.nasa-status{display:flex;align-items:center;gap:8px;font-family:'Share Tech Mono',monospace;font-size:11px;color:#cfe0f2;margin-bottom:14px}
.nasa-dot{width:7px;height:7px;border-radius:50%;background:#00e5ff;flex-shrink:0}
.nasa-dot.varrendo{animation:nasaPulse 1.1s ease-in-out infinite}
.nasa-dot.erro{background:#ff4d6d}
@keyframes nasaPulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(0,229,255,.55)}50%{opacity:.45;box-shadow:0 0 0 7px rgba(0,229,255,0)}}
.nasa-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.nasa-kpi{border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:9px 10px;background:rgba(0,0,0,.3)}
.nasa-kpi b{display:block;font-family:Orbitron,sans-serif;font-size:19px;line-height:1;color:#00e5ff}
.nasa-kpi span{display:block;margin-top:4px;font-size:9px;color:#6c8099}
.nasa-lin{margin-bottom:7px}
.nasa-lin .t{display:flex;justify-content:space-between;font-size:10px;color:#c3d4e6;margin-bottom:3px}
.nasa-lin .t i{font-style:normal;color:#6c8099;font-family:'Share Tech Mono',monospace}
.nasa-bar{height:4px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.nasa-bar i{display:block;height:100%;border-radius:99px;transition:width .6s cubic-bezier(.22,1,.36,1)}
.nasa-ger{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px}
.nasa-ger div{border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:7px 8px}
.nasa-ger b{font-family:Orbitron,sans-serif;font-size:15px;line-height:1}
.nasa-ger span{display:block;margin-top:3px;font-size:9px;color:#6c8099}
.nasa-nota{font-size:9px;line-height:1.55;color:#5f7590;border-top:1px solid rgba(255,255,255,.07);padding-top:10px;margin-top:4px}
.nasa-hist{display:flex;align-items:flex-end;gap:2px;height:46px}
.nasa-hist i{flex:1;border-radius:2px 2px 0 0;min-height:2px;transition:background .18s}
.nasa-hist i:hover{background:#00e5ff !important}
.nasa-hist-eixo{display:flex;justify-content:space-between;margin-top:4px;
  font-family:'Share Tech Mono',monospace;font-size:8px;color:#5f7590}
.nasa-alerta{border:1px solid rgba(255,176,32,.3);background:rgba(255,176,32,.1);color:#ffd28a;
  border-radius:8px;padding:8px 9px;font-size:9px;line-height:1.5;margin-bottom:14px}
.nasa-erro{border:1px solid rgba(255,77,109,.35);background:rgba(255,77,109,.1);color:#ffb3c1;
  border-radius:8px;padding:9px 10px;font-size:10px;line-height:1.6;margin-bottom:14px}
/* Tela de serviço fora do ar — ocupa o lugar do mapa, no lugar do quadro cinza
   quebrado que o navegador desenha quando o iframe não carrega. */
.nasa-off{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:14px;padding:40px;text-align:center;background:#05070c}
/* O display:flex acima vence o [hidden]{display:none} do navegador — sem esta
   regra o card de falha fica visivel AO LADO do mapa que carregou. */
.nasa-off[hidden]{display:none}
.nasa-off h3{font-family:Orbitron,sans-serif;font-size:14px;letter-spacing:.16em;color:#ff4d6d;margin:0}
.nasa-off p{max-width:440px;margin:0;font-size:12px;line-height:1.7;color:#8fa3ba}
.nasa-off code{font-family:'Share Tech Mono',monospace;font-size:11px;color:#00e5ff;
  background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.2);border-radius:5px;padding:3px 8px}
.nasa-off button{margin-top:6px;font-family:Orbitron,sans-serif;font-size:11px;letter-spacing:.14em;
  color:#0b1220;background:#00e5ff;border:0;border-radius:7px;padding:9px 18px;cursor:pointer;transition:.18s}
.nasa-off button:hover{filter:brightness(1.12)}
.nasa-off button:disabled{opacity:.55;cursor:wait}
@media(max-width:900px){.nasa-rast{display:none}}
`;

  const style = document.createElement('style');
  style.id = 'nasaStyle';
  style.textContent = css;
  document.head.appendChild(style);

  /* ── DOM próprio ─────────────────────────────────────────────────── */
  const wrap = document.createElement('div');
  wrap.id = 'nasaWrap';
  wrap.hidden = true;
  wrap.innerHTML = `
    <div id="nasaBackdrop"></div>
    <div id="nasaSet">
      <div class="nasa-head">
        <span class="nasa-badge">NASA</span>
        <span class="nasa-tit">RASTREIO ORBITAL DE ESPECTRO · ANATEL</span>
        <span class="nasa-alvo" id="nasaAlvo">aguardando alvo</span>
        <button class="nasa-x" id="nasaX" title="fechar o modo NASA">✕</button>
      </div>
      <div class="nasa-body">
        <iframe class="nasa-frame" id="nasaFrame" title="SIGNAL-X"></iframe>
        <div class="nasa-off" id="nasaOff" hidden>
          <h3>CONECTANDO AO SIGNAL-X</h3>
          <p id="nasaOffTxt">Estabelecendo enlace com o serviço de rastreio…</p>
          <p>Se persistir, rode <code>npm run dev</code> na pasta <code>C:\\SIGNAL-X</code>.</p>
          <button id="nasaRetry">↻ TENTAR AGORA</button>
        </div>
        <aside class="nasa-rast" id="nasaRast"></aside>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const frame = $('nasaFrame'), rast = $('nasaRast'), alvoEl = $('nasaAlvo'),
        off = $('nasaOff'), offTxt = $('nasaOffTxt'), retry = $('nasaRetry');

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const COR_OP = {
    VIVO: '#8B5CF6', CLARO: '#EF4444', TIM: '#3B82F6', OI: '#F59E0B',
    ALGAR: '#10B981', BRISANET: '#F97316', UNIFIQUE: '#22C55E', WINITY: '#EC4899',
  };
  const COR_GER = { '5G': '#00E5FF', '4G': '#7C5CFF', '3G': '#FFB020', '2G': '#FF4D6D', OUTRO: '#6B7280' };

  function statusHTML(txt, classe = '') {
    return `<div class="nasa-status"><span class="nasa-dot ${classe}"></span>${esc(txt)}</div>`;
  }

  /* Painel em espera: enquanto a ANATEL não responde, o operador precisa ver
     que a varredura está VIVA — silêncio aqui parece travamento. */
  function esperando(alvo, aguardando) {
    const txt = aguardando || (alvo ? `varrendo ${alvo}…` : 'console pronto — aguardando ordem');
    rast.innerHTML =
      `<p class="nasa-rot">RASTREIO</p>` +
      statusHTML(txt, (aguardando || alvo) ? 'varrendo' : '') +
      `<p class="nasa-nota">A consulta à ANATEL é paginada em blocos de 250 registros.
       Um município leva de 30 a 90 segundos. Use o mapa ao lado para investigar
       enquanto isso.</p>`;
  }

  /**
   * Linha do tempo da implantação.
   *
   * O mapa responde "onde tem antena". Isto responde "desde quando" — e é onde
   * aparece o que nenhum mapa mostra: o ano em que a região parou de crescer e
   * o salto que veio depois.
   */
  function historicoHTML(s) {
    const h = s.historico || [];
    if (!h.length) return '';

    const janela = h.slice(-16);
    const max = Math.max(...janela.map(a => a.novos), 1);
    const barras = janela.map(a =>
      `<i style="height:${Math.max((a.novos / max) * 100, a.novos ? 8 : 3)}%;` +
      `background:${a.novos ? 'rgba(0,229,255,.6)' : 'rgba(255,255,255,.08)'}" ` +
      `title="${a.ano}: ${a.novos} novos · ${a.acumulado} acumulados"></i>`
    ).join('');

    const ger = (s.chegadas || [])
      .filter(c => c.geracao !== 'OUTRO' && c.primeiroAno)
      .map(c => `<div class="nasa-lin"><div class="t">
        <span style="color:${COR_GER[c.geracao] || '#94a3b8'}">${esc(c.geracao)}</span>
        <i>${c.primeiroAno}–${c.ultimoAno}</i></div></div>`).join('');

    return `<p class="nasa-rot" style="margin-top:16px">HISTÓRICO DE IMPLANTAÇÃO</p>
      <div class="nasa-hist">${barras}</div>
      <div class="nasa-hist-eixo">
        <span>${janela[0].ano}</span>
        <span>${h[h.length - 1].acumulado} sites</span>
        <span>${janela[janela.length - 1].ano}</span>
      </div>
      ${ger ? `<p class="nasa-rot" style="margin-top:14px">LICENÇAS VIGENTES</p>${ger}
      <p class="nasa-nota" style="border:0;padding-top:6px;margin-top:0">Janela das licenças
       vigentes, não a chegada da tecnologia — em 2G/3G/4G reflete renovação.
       Só no 5G a primeira data é a chegada real.</p>` : ''}`;
  }

  function falhou(msg) {
    rast.innerHTML =
      `<p class="nasa-rot">RASTREIO</p>` +
      statusHTML('varredura interrompida', 'erro') +
      `<div class="nasa-erro">${esc(msg)}</div>`;
  }

  function render(d) {
    if (d && d.erro) { falhou(d.erro); return; }
    const s = d && d.stats;
    if (!s) { esperando(d && d.alvo, d && d.aguardando); return; }

    if (!s.totalSites) {
      rast.innerHTML = `<p class="nasa-rot">RASTREIO</p>` +
        statusHTML('nenhuma estação licenciada no recorte') +
        `<p class="nasa-nota">A ANATEL não tem registro de estação neste recorte
         com o escopo pedido.</p>`;
      return;
    }

    const maxOp = Math.max(...s.porOperadora.map(o => o.sites), 1);
    const ops = s.porOperadora.map(o => {
      const cor = COR_OP[o.operadora] || '#64748B';
      const pct = Math.round((o.sites / s.totalSites) * 100);
      return `<div class="nasa-lin">
        <div class="t"><span>${esc(o.operadora)}</span><i>${o.sites} · ${pct}%</i></div>
        <div class="nasa-bar"><i style="width:${(o.sites / maxOp) * 100}%;background:${cor}"></i></div>
      </div>`;
    }).join('');

    const gers = s.porGeracao.filter(g => g.sites > 0).map(g => {
      const cor = COR_GER[g.geracao] || '#6B7280';
      return `<div style="border-color:${cor}33">
        <b style="color:${cor}">${g.sites}</b>
        <span>sites com ${esc(g.geracao)}</span>
      </div>`;
    }).join('');

    const bandas = (s.porBanda || []).slice(0, 6).map(b =>
      `<div class="nasa-lin"><div class="t"><span>${esc(b.banda)}</span><i>${b.emissoes}</i></div></div>`
    ).join('');

    rast.innerHTML =
      `<p class="nasa-rot">RASTREIO</p>` +
      statusHTML('varredura concluída') +
      (s.truncado ? `<div class="nasa-alerta">Amostra truncada no teto do scan — a ANATEL
        tinha mais registros. Os números são um piso, não o total.</div>` : '') +
      `<div class="nasa-kpis">
        <div class="nasa-kpi"><b>${s.totalSites}</b><span>sites físicos</span></div>
        <div class="nasa-kpi"><b>${s.totalEmissoes}</b><span>emissões</span></div>
       </div>` +
      `<p class="nasa-rot">OPERADORAS</p>${ops}` +
      `<p class="nasa-rot" style="margin-top:14px">GERAÇÕES</p><div class="nasa-ger">${gers}</div>` +
      (bandas ? `<p class="nasa-rot">ESPECTRO OCUPADO</p>${bandas}` : '') +
      historicoHTML(s) +
      `<p class="nasa-nota">Fonte: ANATEL / Mosaico — licenciamento de estações.
       São dados do que a operadora DECLAROU, não de sinal medido.</p>`;
  }

  let aberto = false, mapaNoAr = false;

  /* Um iframe apontado para um servidor morto pinta um quadro cinza com ícone de
     documento quebrado — que não explica nada e parece defeito da plataforma.
     Perguntamos ao serviço se ele existe ANTES de entregar a tela a ele. */
  async function vivo(ms = 2500) {
    try {
      const r = await fetch(base + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(ms) });
      return r.ok;
    } catch { return false; }
  }

  /* URL da varredura atual. Vem do servidor com os parâmetros da consulta, para
     o deck nascer já apontado para a região investigada — o globo genérico não
     mostra nada do que o operador acabou de pedir. */
  let alvoUrl = null;

  function mostrarMapa() {
    off.hidden = true;
    frame.style.display = '';
    const destino = alvoUrl || base;
    // Recarrega quando o alvo muda; sem isso a segunda varredura mostraria
    // o mapa da primeira.
    if (!mapaNoAr || frame.dataset.destino !== destino) {
      frame.src = destino;
      frame.dataset.destino = destino;
      mapaNoAr = true;
    }
  }

  function mostrarOff(txt) {
    frame.style.display = 'none';
    frame.src = 'about:blank';
    mapaNoAr = false;
    off.hidden = false;
    if (txt) offTxt.textContent = txt;
  }

  /**
   * Conecta ao serviço de rastreio, iniciando-o se preciso.
   *
   * A versão anterior só desenhava um cartão de erro e ficava esperando um
   * clique — o operador tinha que resolver, na mão, um problema que a máquina
   * sabe resolver. Agora o console pede ao ELION que suba o SIGNAL-X e insiste
   * sozinho até ele responder, mostrando o relógio.
   *
   * `manual` marca a tentativa disparada pelo botão, que reinicia a contagem.
   */
  let conectando = false;

  async function conectar(manual = false) {
    if (conectando && !manual) return false;
    conectando = true;
    retry.disabled = true;

    try {
      if (await vivo()) { mostrarMapa(); return true; }

      mostrarOff('Serviço desligado — pedindo ao ELION para iniciar…');

      // Quem sabe subir o serviço é o servidor do ELION. Falha aqui não é fatal:
      // o serviço pode estar subindo por outro caminho, e a espera abaixo pega.
      try {
        await fetch('/api/signalx/start', { signal: AbortSignal.timeout(8000) });
      } catch { /* segue para a espera */ }

      /* Partida fria do Next: ~29 s para subir e ~20 s para compilar a primeira
         rota. Três minutos dão folga real — desistir cedo de um serviço que ia
         funcionar é pior do que esperar. */
      const limite = Date.now() + 180_000;
      while (Date.now() < limite) {
        const s = Math.round((180_000 - (limite - Date.now())) / 1000);
        offTxt.textContent = `Iniciando o serviço de rastreio… ${s}s (a primeira partida é lenta)`;
        if (await vivo(4000)) { mostrarMapa(); return true; }
        await new Promise((r) => setTimeout(r, 2000));
      }

      mostrarOff('O serviço não respondeu em 3 minutos. Abra a pasta do SIGNAL-X e rode "npm install" seguido de "npm run dev" para ver o erro real.');
      return false;
    } finally {
      conectando = false;
      retry.disabled = false;
    }
  }

  function open(info = {}) {
    if (info.base) base = info.base;
    if (info.mapaUrl) alvoUrl = info.mapaUrl;
    const alvo = info.alvo || '';
    alvoEl.textContent = alvo || 'console pronto';

    if (!aberto) {
      wrap.hidden = false;
      requestAnimationFrame(() => wrap.classList.add('on'));
      aberto = true;
    }
    // Conecta sozinho — inclusive subindo o serviço, se ele estiver desligado.
    conectar();
    render(info);
  }

  // O botão é a saída manual: a conexão já acontece sozinha ao abrir o console.
  retry.onclick = () => conectar(true);

  function close() {
    if (!aberto) return;
    wrap.classList.remove('on');
    setTimeout(() => { wrap.hidden = true; frame.src = 'about:blank'; aberto = false; mapaNoAr = false; }, 320);
  }

  $('nasaX').onclick = close;
  $('nasaBackdrop').onclick = close;
  addEventListener('keydown', e => { if (e.key === 'Escape' && aberto) close(); });

  ELX.nasa = { open, close, render, get aberto() { return aberto; } };
})();
