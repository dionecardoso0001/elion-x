/* ═══════════════════════════════════════════════════════════════════════
   ELION-X // SENTINELA — orquestrador (navegador)

   Fluxo de um quadro:
     câmera → percepção (MediaPipe) → rastreador → analisador do modo
            → gestor de alertas → sirene / voz / vibração → agente SAFER-X
            → HUD + painéis
   Orçamento por modo (o celular não roda tudo a 30 quadros/s):
     SENTINELA  objetos ~16 Hz · pose ~9 Hz
     MOTORISTA  rosto a cada quadro · objetos 2 Hz (só para flagrar celular)
     TRÂNSITO   objetos ~22 Hz
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES, MODELOS, MODELOS_POR_MODO, PRESET_DEMO, VERSAO, rotulo } from './config.js';
import { Rastreador } from './rastreador.js';
import { AnalisadorMotorista, celularJuntoAoRosto } from './motorista.js';
import { AnalisadorTransito } from './transito.js';
import { AnalisadorVigilancia } from './vigilancia.js';
import { GestorAlertas } from './alertas.js';
import { narrar, relatorioSituacao, montarTelemetria, analisarProfundo } from './agente.js';
import { Percepcao, abrirCamera, listarCameras, preVoo } from './percepcao.js';
import { Sirene } from './sirene.js';
import { HUD } from './hud.js';

const $ = id => document.getElementById(id);
const agora = () => performance.now();
const NOME_MODO = { sentinela: 'sentinela', motorista: 'motorista', transito: 'trânsito' };
const FALAS_MODO = {
  sentinela: 'Sentinela ativa. Vigilância de perímetro iniciada.',
  motorista: 'Sentinela ativa. Modo motorista. Olhe para a via em postura normal para a calibração.',
  transito: 'Sentinela ativa. Modo trânsito. Monitorando a via à frente.',
};
const ALFABETO = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'ÍNDIA', 'JULIETT', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR'];

/* ── preferências do operador (nunca dado de câmera) ── */
const CHAVE_CFG = 'elx-sentinela-cfg-v1';
const lerCfg = () => { try { return JSON.parse(localStorage.getItem(CHAVE_CFG)) || {}; } catch { return {}; } };
const cfg = Object.assign({
  modo: 'sentinela', zonas: [], roi: { ...LIMIARES.transito.roi }, fov: LIMIARES.transito.fovHorizontalGraus,
  volume: 0.9, voz: true, poses: true, calor: false, demo: false, gpsMov: true, espelhar: null, nv: false, cameras: {},
}, lerCfg());
const salvarCfg = () => { try { localStorage.setItem(CHAVE_CFG, JSON.stringify(cfg)); } catch { /* modo privado */ } };

/* ── estado da operação ── */
const E = {
  modo: cfg.modo, rodando: false, pausado: false,
  stream: null, deviceId: null, facing: null,
  status: null, percepcao: null, hud: null, sirene: new Sirene(),
  rastreador: new Rastreador({ scoreNovo: LIMIARES.deteccao.scoreNovaTrilha }),
  motorista: new AnalisadorMotorista(),
  transito: new AnalisadorTransito({ roi: cfg.roi, fovHorizontalGraus: cfg.fov }),
  vigilancia: new AnalisadorVigilancia(),
  alertas: new GestorAlertas(),
  trilhas: [], poses: [], rosto: null, saida: null,
  ultimo: { objetos: 0, pose: 0, relatorio: 0, dom: 0, auto: -Infinity },
  tVideo: -1, fps: 0, quadrosEm: [], infMs: 0, errosSeguidos: 0,
  gps: { velocidade: null, precisao: null, em: null, watch: null, erro: null },
  zonaEdicao: null, gravador: null, composicao: null, evidencias: 0, analisando: false,
  logGrupo: new Map(),
};

/* ═════════════════ BOOT ═════════════════ */
function logBoot(nivel, texto) {
  const li = document.createElement('li');
  li.className = nivel; li.textContent = texto;
  $('bootLog').append(li); li.scrollIntoView({ block: 'nearest' });
}
function progresso(f) {
  $('bootFill').style.width = `${Math.round(f * 100)}%`;
  $('bootBarra').setAttribute('aria-valuenow', String(Math.round(f * 100)));
}
function erroBoot(msg) {
  const p = $('bootErro'); p.hidden = false; p.textContent = msg;
  logBoot('erro', msg);
}
const modoEscolhido = () => document.querySelector('input[name="modoInicial"]:checked')?.value || 'sentinela';

async function carregarModelos(modo, aoProgresso) {
  const chaves = MODELOS_POR_MODO[modo];
  const total = chaves.reduce((s, k) => s + MODELOS[k].bytes, 0);
  let feito = 0;
  for (const k of chaves) {
    if (E.percepcao.tarefas[k]) { feito += MODELOS[k].bytes; aoProgresso?.(feito / total); continue; }
    await E.percepcao.garantir(k, f => aoProgresso?.((feito + f * MODELOS[k].bytes) / total));
    feito += MODELOS[k].bytes;
  }
}

async function boot() {
  $('opCodigo').textContent = `OPERAÇÃO ${['CORVO', 'LINCE', 'FALCÃO', 'VÍBORA', 'JAGUAR', 'SOMBRA'][Math.floor(Math.random() * 6)]}-${String(Math.floor(Math.random() * 90) + 10)}`;
  const radio = document.querySelector(`input[name="modoInicial"][value="${cfg.modo}"]`);
  if (radio) radio.checked = true;
  logBoot('run', `SENTINELA v${VERSAO} · inicializando núcleo de visão tática`);
  const problemas = preVoo();
  if (problemas.length) { problemas.forEach(erroBoot); return; }
  logBoot('ok', 'contexto seguro · câmera disponível · WebAssembly');
  progresso(0.08);

  E.status = await fetch('api/sentinela/status', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (E.status) {
    const ag = E.status.agente || {};
    logBoot('ok', `servidor ELION-X · runtime ${E.status.mediapipe?.local ? 'na própria origem' : 'via CDN'} · análise profunda ${ag.disponivel ? `ativa (${ag.modelo})` : 'sem chave de IA'}`);
  } else {
    logBoot('aviso', 'servidor ELION-X fora de alcance — percepção local segue; análise profunda desativada');
  }

  E.percepcao = new Percepcao({ status: E.status, aoLog: (n, m) => logBoot(n, m) });
  try {
    logBoot('run', 'carregando runtime MediaPipe Tasks Vision (WebAssembly)');
    const fonte = await E.percepcao.iniciarRuntime();
    logBoot('ok', `runtime de visão · ${fonte}`);
    progresso(0.25);
  } catch (e) { erroBoot(e.message); return; }

  const preparar = async modo => {
    logBoot('run', `pesos neurais da missão ${NOME_MODO[modo].toUpperCase()}: ${MODELOS_POR_MODO[modo].map(k => MODELOS[k].arquivo).join(' + ')}`);
    await carregarModelos(modo, f => progresso(0.25 + 0.72 * f));
  };
  try { await preparar(modoEscolhido()); }
  catch (e) { erroBoot(`Falha ao carregar modelos: ${e.message}`); return; }
  progresso(1);
  logBoot('ok', 'núcleo pronto · aguardando ordem do operador');
  const go = $('bootGo');
  go.disabled = false; go.focus();

  document.querySelectorAll('input[name="modoInicial"]').forEach(r => r.addEventListener('change', async () => {
    go.disabled = true; progresso(0.25);
    try { await preparar(modoEscolhido()); progresso(1); logBoot('ok', 'pronto'); }
    catch (e) { erroBoot(e.message); }
    finally { go.disabled = false; }
  }));

  go.addEventListener('click', async () => {
    // GESTO DO USUÁRIO: áudio e voz só destravam aqui (iOS/Safari/Chrome)
    E.sirene.desbloquear();
    E.sirene.definirVolume(cfg.volume);
    E.sirene.vozLigada = cfg.voz;
    const modo = modoEscolhido();
    E.sirene.falar(FALAS_MODO[modo]);
    go.disabled = true;
    try {
      await carregarModelos(modo);
      await iniciarOperacao(modo);
      $('boot').classList.add('saindo');
      setTimeout(() => { $('boot').hidden = true; }, 520);
    } catch (e) {
      go.disabled = false;
      erroBoot(e.name === 'NotAllowedError'
        ? 'Permissão de câmera negada. Libere a câmera nas configurações do navegador para este endereço e tente de novo.'
        : `Não foi possível iniciar: ${e.message}`);
    }
  }, { once: false });
}

/* ═════════════════ CÂMERA ═════════════════ */
const facingPadrao = modo => (modo === 'motorista' ? 'user' : modo === 'transito' ? 'environment' : null);

async function abrir(modo, { deviceId = cfg.cameras[modo] || null, facing = facingPadrao(modo) } = {}) {
  const v = $('video');
  let stream;
  try { stream = await abrirCamera({ deviceId, facingMode: deviceId ? null : facing }); }
  catch (e) {
    if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
      delete cfg.cameras[modo]; salvarCfg();       // câmera salva sumiu (outro aparelho, USB desplugada)
      stream = await abrirCamera({ facingMode: facing });
    } else throw e;
  }
  E.stream?.getTracks().forEach(t => t.stop());
  E.stream = stream;
  v.srcObject = stream;
  await v.play().catch(() => {});
  // proporção real do quadro: o CSS do celular dimensiona o visor por ela
  const ajustarProporcao = () => { if (v.videoWidth) $('visor').style.setProperty('--ar', `${v.videoWidth} / ${v.videoHeight}`); };
  ajustarProporcao();
  v.onresize = ajustarProporcao;   // celular girado troca a proporção do fluxo
  const trilha = stream.getVideoTracks()[0];
  const s = trilha?.getSettings?.() || {};
  E.deviceId = s.deviceId || deviceId;
  E.facing = s.facingMode || facing;
  aplicarEspelho();
  await preencherCameras();
  E.tVideo = -1;
}

function aplicarEspelho() {
  const auto = E.facing ? E.facing === 'user' : E.modo !== 'transito';
  const esp = cfg.espelhar ?? auto;
  document.body.classList.toggle('espelhado', esp);
  if (E.hud) E.hud.espelhar = esp;
  $('btnEspelhar').setAttribute('aria-pressed', String(esp));
}

async function preencherCameras() {
  const sel = $('selCamera');
  const cams = await listarCameras();
  sel.replaceChildren(new Option('padrão do modo', ''));
  cams.forEach((c, i) => sel.append(new Option(c.label || `câmera ${i + 1}`, c.deviceId)));
  sel.value = cfg.cameras[E.modo] || '';
}

/* ═════════════════ GPS ═════════════════ */
function iniciarGPS() {
  if (E.gps.watch != null || !navigator.geolocation) return;
  E.gps.watch = navigator.geolocation.watchPosition(
    p => { E.gps.velocidade = p.coords.speed; E.gps.precisao = p.coords.accuracy; E.gps.em = agora(); E.gps.erro = null; },
    err => { E.gps.erro = err.code === 1 ? 'negado' : 'sem sinal'; },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
}
const velocidadeGPS = () => (E.gps.em != null && agora() - E.gps.em < 5000 && E.gps.velocidade != null && isFinite(E.gps.velocidade) ? E.gps.velocidade : null);

/* ═════════════════ OPERAÇÃO ═════════════════ */
async function iniciarOperacao(modo) {
  E.hud = new HUD($('hud'), $('video'));
  aplicarModoUI(modo);
  await abrir(modo);
  aplicarDemo();
  E.sirene.manterTelaLigada();
  if (modo !== 'sentinela') iniciarGPS();
  E.rodando = true;
  logAgente({ nivel: 'sistema', texto: `◈ SAFER-X ONLINE — missão ${NOME_MODO[modo].toUpperCase()} · ${$('opCodigo').textContent}` });
  requestAnimationFrame(laco);
}

function aplicarModoUI(modo) {
  E.modo = modo;
  document.body.dataset.modo = modo;
  document.querySelectorAll('.modo-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.modo === modo)));
  document.querySelectorAll('.modo-so').forEach(p => { p.hidden = p.dataset.so !== modo; });
  $('telModo').textContent = NOME_MODO[modo].toUpperCase();
  if (modo !== 'sentinela') cancelarZona();
}

function reiniciarAnalise() {
  E.rastreador.reiniciar(); E.motorista.reiniciar(); E.transito.reiniciar(); E.vigilancia.reiniciar();
  E.trilhas = []; E.poses = []; E.rosto = null; E.saida = null;
  E.alertas.sincronizar([], agora() + 1e7);   // encerra condições do modo anterior
  E.sirene.desligar(); E.sirene.calar();
}

async function trocarModo(novo) {
  if (novo === E.modo || !E.rodando) return;
  cfg.modo = novo; salvarCfg();
  aplicarModoUI(novo);
  reiniciarAnalise();
  const sob = $('sobreposicao');
  const pendentes = MODELOS_POR_MODO[novo].filter(k => !E.percepcao.tarefas[k]);
  if (pendentes.length) {
    sob.hidden = false; $('sobTitulo').textContent = `MISSÃO ${NOME_MODO[novo].toUpperCase()}`;
    $('sobTexto').textContent = `carregando ${pendentes.map(k => MODELOS[k].arquivo).join(' + ')}`;
  }
  try {
    await carregarModelos(novo, f => { $('sobFill').style.width = `${Math.round(f * 100)}%`; });
    const facingAtual = E.facing, facingNovo = facingPadrao(novo);
    const deviceNovo = cfg.cameras[novo] || null;
    if ((deviceNovo && deviceNovo !== E.deviceId) || (!deviceNovo && facingNovo && facingNovo !== facingAtual)) await abrir(novo);
    else aplicarEspelho();
    if (novo !== 'sentinela') iniciarGPS();
    E.sirene.falar(FALAS_MODO[novo]);
    logAgente({ nivel: 'sistema', texto: `◈ MISSÃO ALTERADA → ${NOME_MODO[novo].toUpperCase()}` });
  } catch (e) {
    logAgente({ nivel: 'aviso', texto: `Falha ao preparar a missão: ${e.message}` });
  } finally { sob.hidden = true; }
}

/* ═════════════════ LAÇO ═════════════════ */
function laco() {
  if (!E.rodando) return;
  requestAnimationFrame(laco);
  const t = agora(), v = $('video');
  if (v.readyState >= 2 && v.videoWidth && !E.pausado && v.currentTime !== E.tVideo) {
    E.tVideo = v.currentTime;
    try { processar(v, t); E.errosSeguidos = 0; }
    catch (e) {
      if (++E.errosSeguidos === 30) logAgente({ nivel: 'aviso', texto: `Falha recorrente na inferência: ${e.message}` });
      console.error('[sentinela]', e);
    }
  }
  desenhar(t);
  if (t - E.ultimo.dom >= 250) { E.ultimo.dom = t; atualizarPaineis(t); }
}

function processar(v, t) {
  const t0 = performance.now();
  const aspecto = v.videoWidth / v.videoHeight;
  E.rastreador.aspecto = aspecto;
  const P = E.percepcao;
  let saida;
  if (E.modo === 'sentinela') {
    if (t - E.ultimo.objetos >= 60) { E.ultimo.objetos = t; const d = P.objetos(v, t); if (d) E.trilhas = E.rastreador.atualizar(d, t); }
    // aparelho lento: a pose cede espaço — objetos alimentam intrusão e abandono, que são prioridade
    if (cfg.poses && P.tarefas.pose && t - E.ultimo.pose >= Math.max(110, 1.5 * E.infMs)) { E.ultimo.pose = t; E.poses = P.poses(v, t) || []; }
    if (!cfg.poses) E.poses = [];
    saida = E.vigilancia.processar({ t, trilhas: E.trilhas, poses: E.poses, zonas: cfg.zonas, aspecto });
  } else if (E.modo === 'motorista') {
    E.rosto = P.rosto(v, t);
    let celular = null;
    if (P.tarefas.objetos && t - E.ultimo.objetos >= 500) {
      E.ultimo.objetos = t;
      celular = celularJuntoAoRosto(P.objetos(v, t) || [], E.rosto?.pontos);
    }
    E.trilhas = [];
    saida = E.motorista.processar({ t, rosto: E.rosto, aspecto, celular, velocidade: cfg.gpsMov ? velocidadeGPS() : null });
  } else {
    if (t - E.ultimo.objetos >= 45) { E.ultimo.objetos = t; const d = P.objetos(v, t); if (d) E.trilhas = E.rastreador.atualizar(d, t); }
    saida = E.transito.processar({ t, trilhas: E.trilhas, aspecto, velocidade: velocidadeGPS() });
  }
  E.infMs = 0.85 * E.infMs + 0.15 * (performance.now() - t0);
  E.quadrosEm.push(t);
  while (E.quadrosEm.length && t - E.quadrosEm[0] > 1000) E.quadrosEm.shift();
  E.fps = E.quadrosEm.length;
  E.saida = saida;
  tratarAlertas(saida, t);
}

/* ═════════════════ ALERTAS ═════════════════ */
function tratarAlertas(saida, t) {
  for (const e of saida.eventos) {
    const reg = E.alertas.evento(e, t);
    if (reg) logAgente(narrar(reg), reg.nivel === 'aviso' ? evidencia() : null);
  }
  const { novas, escaladas, encerradas } = E.alertas.sincronizar(saida.condicoes, t);
  for (const c of [...novas, ...escaladas]) {
    // quatro animais na pista são UMA ameaça para quem dirige: o registro do
    // gestor guarda cada alvo, mas a tela narra o grupo uma vez a cada 5 s
    const g = c.grupo || c.chave;
    const ult = E.logGrupo.get(g);
    const repetido = ult && t - ult.t < 5000 && ult.nivel === c.nivel;
    E.logGrupo.set(g, { t, nivel: c.nivel });
    if (!repetido) logAgente(narrar(c), c.nivel === 'critico' ? evidencia() : null);
    if (c.nivel === 'critico') {
      E.sirene.vibrar();
      $('srAlerta').textContent = `${c.titulo}. ${c.detalhe || ''}`;
      if ($('chkAutoAnalise').checked && t - E.ultimo.auto >= LIMIARES.agente.intervaloAutoMs) { E.ultimo.auto = t; analiseProfunda('auto'); }
    } else if (c.nivel === 'aviso') {
      E.sirene.bipe('aviso');
      $('srInfo').textContent = c.titulo;
    }
  }
  for (const c of encerradas) logAgente({ nivel: 'info', texto: `✓ NORMALIZADO: ${c.titulo}` });

  if (E.alertas.sireneLigada(t)) E.sirene.ligar(); else E.sirene.desligar();
  if (!E.sirene.falando) {
    const f = E.alertas.proximaFala(t);
    if (f) E.sirene.falar(f.texto, { urgente: f.nivel === 'critico' });
  }
}

/* ═════════════════ DESENHO ═════════════════ */
function desenhar(t) {
  if (!E.hud) return;
  const s = E.saida || {};
  const nivel = E.alertas.nivelAtual();
  E.hud.desenhar({
    modo: E.modo, agora: t, nivel, fps: E.fps, infMs: E.infMs, gravando: !!E.gravador,
    trilhas: E.modo === 'motorista' ? [] : E.trilhas,
    sentinela: E.modo === 'sentinela' ? {
      zonas: cfg.zonas, zonaEdicao: E.zonaEdicao, poses: E.poses, mostrarPoses: cfg.poses,
      pessoas: s.pessoas, objetos: s.objetos, abandonoS: E.vigilancia.cfg.abandonoS,
      mostrarCalor: cfg.calor, calor: cfg.calor ? E.vigilancia.normalidade.mapaDeCalor() : null, grade: E.vigilancia.normalidade.cfg.grade,
    } : null,
    motorista: E.modo === 'motorista' ? { rosto: E.rosto, metricas: s.metricas } : null,
    transito: E.modo === 'transito' ? { roi: E.transito.cfg.roi, alvos: s.alvos } : null,
  });
  if (E.gravador) compor(E.composicao);
}

/** Composição vídeo + HUD num canvas (gravação e captura). */
function compor(cv) {
  const h = E.hud, v = $('video');
  cv.width = h.c.width; cv.height = h.c.height;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const r = h.rect;
  g.save();
  if (h.espelhar) { g.translate(r.x + r.w, r.y); g.scale(-1, 1); g.drawImage(v, 0, 0, r.w, r.h); }
  else g.drawImage(v, r.x, r.y, r.w, r.h);
  g.restore();
  g.drawImage(h.c, 0, 0);
  return cv;
}

/** Quadro cru (sem HUD) em JPEG base64 — é o que a análise profunda vê. */
function quadroJPEG(largura, qualidade) {
  const v = $('video');
  if (!v.videoWidth) return null;
  const w = Math.min(largura, v.videoWidth), h = Math.round((w * v.videoHeight) / v.videoWidth);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(v, 0, 0, w, h);
  return cv.toDataURL('image/jpeg', qualidade);
}
function evidencia() {
  if (E.evidencias >= 40) return null;
  E.evidencias++;
  return quadroJPEG(320, 0.6);
}

/* ═════════════════ AGENTE ═════════════════ */
function logAgente(n, foto = null) {
  const ol = $('agenteLog');
  const li = document.createElement('li');
  li.className = `${n.nivel || 'info'} novo`;
  const tm = document.createElement('time'); tm.textContent = n.hora || new Date().toTimeString().slice(0, 8);
  const tx = document.createElement('span'); tx.className = 'txt'; tx.textContent = n.texto;
  li.append(tm, tx);
  if (n.protocolo) { const p = document.createElement('span'); p.className = 'prot'; p.textContent = n.protocolo; li.append(p); }
  if (foto) { const im = new Image(); im.src = foto; im.alt = 'quadro de evidência no instante do alerta'; li.append(im); }
  ol.append(li);
  setTimeout(() => li.classList.remove('novo'), 700);
  while (ol.children.length > 140) ol.firstElementChild.remove();
  ol.scrollTop = ol.scrollHeight;
  const tk = $('ticker');
  tk.textContent = `${tm.textContent} ${n.texto}  ·  ${tk.textContent}`.slice(0, 400);
}

async function analiseProfunda(origem = 'manual') {
  if (E.analisando) return;
  if (!E.status?.agente?.disponivel) {
    logAgente({ nivel: 'aviso', texto: 'Análise profunda indisponível: o servidor ELION-X não está acessível ou não tem chave de IA (ANTHROPIC_API_KEY).' });
    return;
  }
  const jpeg = quadroJPEG(LIMIARES.agente.larguraQuadro, LIMIARES.agente.qualidadeJpeg);
  if (!jpeg) return;
  E.analisando = true;
  $('btnAnalise').disabled = true; $('agenteStatus').textContent = 'ANALISANDO…';
  logAgente({ nivel: 'sistema', texto: `◈ ${origem === 'auto' ? 'Evento crítico — ' : ''}enviando 1 quadro ao SAFER-X profundo para avaliação de cena…` });
  try {
    const tel = montarTelemetria({
      modo: E.modo, defcon: E.alertas.defcon(agora()), ativas: E.alertas.listaAtivas(),
      historico: E.alertas.historico, trilhas: E.trilhas, metricas: E.saida?.metricas, zonas: cfg.zonas,
    });
    const r = await analisarProfundo({ imagemB64: jpeg.split(',')[1], modo: E.modo, telemetria: tel, signal: AbortSignal.timeout(75000) });
    mostrarAnalise(r);
    if (r.analise?.resumo) {
      logAgente({ nivel: ['alto', 'critico'].includes(r.analise.nivel_risco) ? 'critico' : 'sistema', texto: `◈ AVALIAÇÃO PROFUNDA [${String(r.analise.nivel_risco || '?').toUpperCase()}]: ${r.analise.resumo}` });
      if (origem === 'manual' && E.modo !== 'motorista') E.sirene.falar(r.analise.resumo);
    } else if (r.recusa) logAgente({ nivel: 'aviso', texto: 'O modelo recusou analisar este quadro.' });
  } catch (e) {
    logAgente({ nivel: 'aviso', texto: `Análise profunda falhou: ${e.message}` });
  } finally {
    E.analisando = false;
    $('btnAnalise').disabled = false; $('agenteStatus').textContent = 'LOCAL';
  }
}

/** Renderiza a resposta do modelo SÓ com textContent: saída de LLM é dado não confiável. */
function mostrarAnalise(r) {
  const card = $('analiseCard');
  card.replaceChildren();
  const a = r.analise;
  if (!a) { card.hidden = true; return; }
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; };
  const h3 = el('h3', null, 'AVALIAÇÃO PROFUNDA');
  h3.append(el('span', `risco ${a.nivel_risco}`, `RISCO ${String(a.nivel_risco).toUpperCase()}`));
  card.append(h3, el('p', null, a.resumo));
  const lista = (titulo, itens, cls) => {
    if (!itens?.length) return;
    card.append(el('b', null, titulo));
    const ul = el('ul');
    itens.forEach(i => ul.append(el('li', cls, i)));
    card.append(ul);
  };
  lista('Comportamentos', (a.comportamentos || []).map(c => `[${c.risco}] ${c.descricao} — ${c.evidencia}`));
  lista('Recomendações', a.recomendacoes);
  lista('Divergências com o detector local', a.divergencias, 'div');
  card.append(el('small', null, `confiança ${a.confianca} · ${r.provedor || ''} ${r.modelo || ''}`.trim()));
  card.hidden = false;
}

/* ═════════════════ PAINÉIS ═════════════════ */
const NIVEL_DEFCON = { 5: 'NOMINAL', 4: 'ATENÇÃO', 3: 'ELEVADO', 2: 'ALTO', 1: 'CRÍTICO' };

function atualizarPaineis(t) {
  const d = new Date();
  $('clk').textContent = d.toLocaleTimeString('pt-BR');
  $('clkUtc').textContent = `UTC ${d.toISOString().slice(11, 16)}`;
  const dc = E.alertas.defcon(t);
  document.body.dataset.nivel = String(dc);
  $('defcon').dataset.lv = String(dc);
  $('defconVal').textContent = String(dc);
  $('defconTxt').textContent = NIVEL_DEFCON[dc];

  // alertas ativos + faixa principal
  const ativas = E.alertas.listaAtivas();
  const grupos = new Map();   // um chip por tipo de ameaça, com a contagem de alvos
  for (const c of ativas) {
    const g = grupos.get(c.titulo);
    if (g) g.n++; else grupos.set(c.titulo, { c, n: 1 });
  }
  $('ativas').replaceChildren(...[...grupos.values()].slice(0, 6).map(({ c, n }) => {
    const s = document.createElement('span');
    s.className = `chip ${c.nivel}`;
    s.textContent = `${c.nivel === 'critico' ? '▲' : c.nivel === 'aviso' ? '◆' : '·'} ${c.titulo}${n > 1 ? ` ×${n}` : ''}`;
    return s;
  }));
  const topo = ativas.find(c => c.nivel !== 'info');
  const banner = $('banner');
  if (topo && !E.pausado) {
    banner.hidden = false; banner.className = `banner ${topo.nivel === 'critico' ? '' : 'aviso'}`;
    $('bannerTitulo').textContent = topo.titulo; $('bannerDetalhe').textContent = topo.detalhe || '';
  } else banner.hidden = true;
  $('btnEstouBem').hidden = !(E.modo === 'motorista' && topo?.nivel === 'critico');

  // telemetria
  const m = E.saida?.metricas || {};
  const linhas = [];
  const add = (rot, val, cls = '', largo = false) => linhas.push({ rot, val, cls, largo });
  if (E.modo === 'motorista') {
    if (m.calibrando) add('estado', `CALIBRANDO ${Math.round((m.progressoCalibracao || 0) * 100)}%`, 'aviso', true);
    else add('estado', m.presente === false ? 'FORA DE VISÃO' : m.fechado ? 'OLHOS FECHADOS' : 'ATENTO', m.presente === false || m.fechado ? 'critico' : '', true);
    add('índice de fadiga', `${m.indiceFadiga ?? 0}/100`, (m.indiceFadiga || 0) >= 70 ? 'critico' : (m.indiceFadiga || 0) >= 40 ? 'aviso' : '');
    add('PERCLOS (60 s)', `${((m.perclos || 0) * 100).toFixed(1)}%`, (m.perclos || 0) >= 0.12 ? 'critico' : (m.perclos || 0) >= 0.08 ? 'aviso' : '');
    add('EAR / base', `${(m.ear ?? 0).toFixed(2)} / ${(m.earBase ?? 0).toFixed(2)}`);
    add('piscadas/min', `${m.piscadasMin ?? 0}`);
    add('bocejos (5 min)', `${m.bocejos5min ?? 0}`, (m.bocejos5min || 0) >= 3 ? 'aviso' : '');
    add('acenos (5 min)', `${m.acenos5min ?? 0}`);
    add('guinada · arfagem', `${fmtG(m.yaw)} · ${fmtG(m.pitch)}`);
    add('rolagem', fmtG(m.roll));
    add('celular', m.celular ? 'DETECTADO' : 'não', m.celular ? 'aviso' : '');
    add('veículo', velocidadeGPS() != null ? `${(velocidadeGPS() * 3.6).toFixed(0)} km/h` : 'sem GPS (assume em movimento)', '', true);
  } else if (E.modo === 'transito') {
    const l = m.lider, c = m.contagem || {};
    add('veículo-líder', l ? `${rotulo(l.classe)} TGT-${l.id}` : 'corredor livre', '', true);
    add('distância', l?.z != null ? `~${l.z.toFixed(0)} m` : '—');
    add('TTC', l && isFinite(l.ttc) ? `${l.ttc.toFixed(1)} s` : '∞', l && l.ttc <= LIMIARES.transito.ttcCriticoS ? 'critico' : l && l.ttc <= LIMIARES.transito.ttcAvisoS ? 'aviso' : '');
    add('distância temporal', l?.thw != null ? `${l.thw.toFixed(1)} s` : '—', l?.thw != null && l.thw < 1 ? 'aviso' : '');
    add('fechamento', l?.fechamento != null ? `${l.fechamento.toFixed(1)} m/s` : '—');
    add('velocidade (GPS)', m.velocidade != null ? `${(m.velocidade * 3.6).toFixed(0)} km/h` : '—');
    add('veículos', `${c.veiculo || 0}`); add('pedestres', `${c.pedestre || 0}`, c.pedestre ? 'aviso' : '');
    add('animais', `${c.animal || 0}`); add('obstáculos', `${c.obstaculo || 0}`);
  } else {
    add('pessoas', `${m.pessoas ?? 0}`);
    add('objetos vigiados', `${m.objetos ?? 0}`);
    add('sem dono', `${m.semDono ?? 0}`, m.semDono ? 'aviso' : '');
    add('abandonados', `${m.abandonados ?? 0}`, m.abandonados ? 'critico' : '');
    add('zonas', `${cfg.zonas.length}`);
    add('esqueletos', `${m.poses ?? 0}`);
    const n = m.normalidade;
    add('modelo de normalidade', n ? (n.aquecido ? 'ATIVO' : `aprendendo ${Math.min(100, Math.round((100 * n.amostras) / n.alvo))}%`) : '—', '', true);
    if (E.vigilancia.cfg.abandonoS !== LIMIARES.vigilancia.abandonoS) add('preset', 'DEMONSTRAÇÃO — tempos encurtados', 'aviso', true);
  }
  $('telemetria').replaceChildren(...linhas.map(l => {
    const div = document.createElement('div'); if (l.largo) div.className = 'largo';
    const dt = document.createElement('dt'); dt.textContent = l.rot;
    const dd = document.createElement('dd'); dd.textContent = l.val; if (l.cls) dd.className = l.cls;
    div.append(dt, dd); return div;
  }));

  // rodapé
  $('rFps').textContent = String(E.fps);
  $('rInf').textContent = `${E.infMs.toFixed(0)} ms`;
  $('rBackend').textContent = MODELOS_POR_MODO[E.modo].map(k => `${k} ${E.percepcao?.backend[k] || '…'}`).join(' · ');
  $('rRuntime').textContent = E.percepcao?.fonte || '--';
  $('rGps').textContent = E.gps.watch == null ? 'desligado' : E.gps.erro ? E.gps.erro : velocidadeGPS() != null ? `${(velocidadeGPS() * 3.6).toFixed(0)} km/h ±${Math.round(E.gps.precisao || 0)} m` : 'aguardando sinal';

  // relatório de situação periódico
  if (t - E.ultimo.relatorio >= LIMIARES.agente.intervaloResumoMs && E.saida) {
    E.ultimo.relatorio = t;
    const rel = relatorioSituacao(E.modo, E.saida.metricas, dc);
    if (rel) logAgente({ nivel: 'sistema', texto: rel });
  }
}
const fmtG = v => {
  if (v == null || !isFinite(v)) return '--';
  const n = Math.round(v) || 0;   // "|| 0" elimina o −0
  return `${n > 0 ? '+' : ''}${n}°`;
};

/* ═════════════════ ZONAS ═════════════════ */
function renderZonas() {
  const ul = $('listaZonas');
  ul.replaceChildren(...cfg.zonas.map(z => {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = z.tipo; n.textContent = `▣ ${z.nome} · ${z.tipo === 'restrita' ? 'RESTRITA' : 'MONITORADA'}`;
    const b = document.createElement('button'); b.textContent = 'REMOVER'; b.setAttribute('aria-label', `remover zona ${z.nome}`);
    b.onclick = () => { cfg.zonas = cfg.zonas.filter(x => x.id !== z.id); salvarCfg(); renderZonas(); };
    li.append(n, b); return li;
  }));
}
function iniciarZona() {
  E.zonaEdicao = { tipo: $('selTipoZona').value, pontos: [] };
  document.body.classList.add('editando');
  $('edicaoZona').hidden = false; $('dicaZona').hidden = false;
}
function cancelarZona() {
  E.zonaEdicao = null;
  document.body.classList.remove('editando');
  $('edicaoZona').hidden = true; $('dicaZona').hidden = true;
}
function fecharZona() {
  const z = E.zonaEdicao;
  if (!z || z.pontos.length < 3) { logAgente({ nivel: 'aviso', texto: 'Uma zona precisa de pelo menos 3 vértices.' }); return; }
  const usados = new Set(cfg.zonas.map(x => x.nome));
  const nome = ALFABETO.find(n => !usados.has(n)) || `Z${cfg.zonas.length + 1}`;
  cfg.zonas.push({ id: `z${Date.now().toString(36)}`, nome, tipo: z.tipo, pontos: z.pontos });
  salvarCfg(); renderZonas(); cancelarZona();
  logAgente({ nivel: 'sistema', texto: `◈ PERÍMETRO ${nome} estabelecido (${z.tipo === 'restrita' ? 'acesso restrito' : 'monitorado'})` });
}

/* ═════════════════ GRAVAÇÃO / CAPTURA / EXPORTAÇÃO ═════════════════ */
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
function baixar(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function alternarGravacao() {
  const btn = $('btnGravar');
  if (E.gravador) { E.gravador.stop(); return; }
  if (!window.MediaRecorder || !E.hud) { logAgente({ nivel: 'aviso', texto: 'Gravação não suportada neste navegador.' }); return; }
  E.composicao = document.createElement('canvas');
  compor(E.composicao);
  const tipo = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(E.composicao.captureStream(25), tipo ? { mimeType: tipo, videoBitsPerSecond: 4e6 } : undefined);
  const partes = [];
  rec.ondataavailable = ev => ev.data.size && partes.push(ev.data);
  rec.onstop = () => {
    const ext = (rec.mimeType || tipo).includes('mp4') ? 'mp4' : 'webm';
    baixar(new Blob(partes, { type: rec.mimeType || tipo }), `sentinela-${carimbo()}.${ext}`);
    E.gravador = null; btn.setAttribute('aria-pressed', 'false'); btn.textContent = '● GRAVAR';
    logAgente({ nivel: 'sistema', texto: '◈ Gravação encerrada — arquivo salvo neste aparelho.' });
  };
  rec.start(1000);
  E.gravador = rec; btn.setAttribute('aria-pressed', 'true'); btn.textContent = '■ PARAR';
  logAgente({ nivel: 'sistema', texto: '◈ Gravando vídeo com o HUD (fica só neste aparelho).' });
}
function capturar() {
  if (!E.hud) return;
  compor(document.createElement('canvas')).toBlob(b => b && baixar(b, `sentinela-${carimbo()}.png`), 'image/png');
}
function exportarLog() {
  const dados = {
    sistema: `ELION-X SENTINELA v${VERSAO}`, exportado_em: new Date().toISOString(), modo: E.modo,
    zonas: cfg.zonas.map(z => ({ nome: z.nome, tipo: z.tipo, pontos: z.pontos })),
    eventos: E.alertas.historico.map(e => ({ instante_ms: Math.round(e.t), tipo: e.tipo, nivel: e.nivel, titulo: e.titulo, detalhe: e.detalhe ?? null, alvo: e.alvo ?? null })),
  };
  baixar(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }), `sentinela-log-${carimbo()}.json`);
}

/* ═════════════════ CONTROLES ═════════════════ */
function ligarControles() {
  // dentro do visor da central (iframe), a marca fecha o visor em vez de carregar a central dentro de si mesma
  if (window.top !== window) {
    document.querySelector('.marca')?.addEventListener('click', ev => {
      ev.preventDefault();
      E.stream?.getTracks().forEach(t => t.stop());
      parent.postMessage({ elx: 'sentinela-close' }, location.origin);
    });
  }
  document.querySelectorAll('.modo-tab').forEach(b => b.addEventListener('click', () => trocarModo(b.dataset.modo)));
  document.querySelectorAll('#abas button').forEach(b => b.addEventListener('click', () => {
    document.body.dataset.aba = b.dataset.aba;
    document.querySelectorAll('#abas button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.body.dataset.aba = 'colDir';

  $('selCamera').addEventListener('change', async e => {
    if (e.target.value) cfg.cameras[E.modo] = e.target.value; else delete cfg.cameras[E.modo];
    salvarCfg();
    try { await abrir(E.modo); } catch (er) { logAgente({ nivel: 'aviso', texto: `Câmera: ${er.message}` }); }
  });
  $('btnTrocarCam').addEventListener('click', async () => {
    delete cfg.cameras[E.modo]; salvarCfg();
    const proximo = E.facing === 'user' ? 'environment' : 'user';
    cfg.espelhar = null;
    try { await abrir(E.modo, { deviceId: null, facing: proximo }); } catch (er) { logAgente({ nivel: 'aviso', texto: `Câmera: ${er.message}` }); }
  });
  $('btnEspelhar').addEventListener('click', () => {
    const atual = document.body.classList.contains('espelhado');
    cfg.espelhar = !atual; salvarCfg(); aplicarEspelho();
  });
  const alternar = (id, classe, chave) => {
    const b = $(id);
    const aplicar = v => { document.body.classList.toggle(classe, v); b.setAttribute('aria-pressed', String(v)); };
    aplicar(chave ? !!cfg[chave] : false);
    b.addEventListener('click', () => {
      const v = !document.body.classList.contains(classe);
      if (chave) { cfg[chave] = v; salvarCfg(); }
      aplicar(v);
    });
  };
  alternar('btnNV', 'nv', 'nv');
  alternar('btnDiscreto', 'discreto', null);

  $('btnPausar').addEventListener('click', e => {
    E.pausado = !E.pausado;
    e.currentTarget.setAttribute('aria-pressed', String(E.pausado));
    e.currentTarget.textContent = E.pausado ? '▶ RETOMAR' : '❚❚ PAUSAR';
    if (E.pausado) { E.sirene.desligar(); E.sirene.calar(); }
    logAgente({ nivel: 'sistema', texto: E.pausado ? '◈ Percepção PAUSADA — nenhum alarme será emitido.' : '◈ Percepção retomada.' });
  });
  $('btnFoto').addEventListener('click', capturar);
  $('btnGravar').addEventListener('click', alternarGravacao);
  $('btnTelaCheia').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });

  const silenciar = origem => {
    E.alertas.silenciar(agora()); E.sirene.desligar(); E.sirene.calar();
    logAgente({ nivel: 'sistema', texto: `◈ Alarme silenciado por 30 s${origem ? ` (${origem})` : ''}.` });
  };
  $('btnSilenciar').addEventListener('click', () => silenciar());
  $('btnEstouBem').addEventListener('click', () => silenciar('condutor confirmou que está bem'));
  const voz = $('btnVoz');
  const aplicarVoz = () => { voz.setAttribute('aria-pressed', String(cfg.voz)); voz.textContent = cfg.voz ? '🗣 VOZ LIGADA' : '🗣 VOZ DESLIGADA'; E.sirene.vozLigada = cfg.voz; };
  aplicarVoz();
  voz.addEventListener('click', () => { cfg.voz = !cfg.voz; salvarCfg(); aplicarVoz(); if (!cfg.voz) E.sirene.calar(); });
  const vol = $('rngVolume');
  vol.value = String(Math.round(cfg.volume * 100)); $('outVolume').textContent = `${vol.value}%`;
  vol.addEventListener('input', () => { cfg.volume = vol.value / 100; E.sirene.definirVolume(cfg.volume); $('outVolume').textContent = `${vol.value}%`; salvarCfg(); });
  $('btnTestarSirene').addEventListener('click', () => {
    E.sirene.desbloquear(); E.sirene.ligar();
    setTimeout(() => { if (!E.alertas.sireneLigada(agora())) E.sirene.desligar(); E.sirene.falar('Teste de alarme concluído.'); }, 1600);
  });

  // perímetros
  $('btnZona').addEventListener('click', iniciarZona);
  $('btnFecharZona').addEventListener('click', fecharZona);
  $('btnCancelarZona').addEventListener('click', cancelarZona);
  $('hud').addEventListener('pointerdown', ev => {
    if (!E.zonaEdicao || !E.hud) return;
    const p = E.hud.normalizar(ev.clientX, ev.clientY);
    if (p) E.zonaEdicao.pontos.push(p);
  });
  const chk = (id, chave, aoMudar) => {
    const c = $(id); c.checked = !!cfg[chave];
    c.addEventListener('change', () => { cfg[chave] = c.checked; salvarCfg(); aoMudar?.(); });
  };
  chk('chkPoses', 'poses');
  chk('chkCalor', 'calor');
  chk('chkDemo', 'demo', aplicarDemo);
  chk('chkGPSmov', 'gpsMov');
  renderZonas();

  $('btnRecalibrar').addEventListener('click', () => {
    E.motorista.recalibrar();
    logAgente({ nivel: 'sistema', texto: '◈ Recalibrando o condutor — olhe para a via em postura normal.' });
    E.sirene.falar('Recalibrando. Olhe para a via em postura normal.');
  });

  // corredor do trânsito
  const faixa = (id, saida, ler, escrever, fmt) => {
    const r = $(id); r.value = String(ler());
    const mostrar = () => { $(saida).textContent = fmt(Number(r.value)); };
    mostrar();
    r.addEventListener('input', () => { escrever(Number(r.value)); mostrar(); salvarCfg(); });
  };
  const roi = () => { E.transito.definirROI(cfg.roi); };
  faixa('rngHorizonte', 'outHorizonte', () => Math.round(cfg.roi.topoY * 100), v => { cfg.roi.topoY = v / 100; roi(); }, v => `${v}%`);
  faixa('rngLargTopo', 'outLargTopo', () => Math.round(cfg.roi.larguraTopo * 100), v => { cfg.roi.larguraTopo = v / 100; roi(); }, v => `${v}%`);
  faixa('rngLargBase', 'outLargBase', () => Math.round(cfg.roi.larguraBase * 100), v => { cfg.roi.larguraBase = v / 100; roi(); }, v => `${v}%`);
  faixa('rngFov', 'outFov', () => cfg.fov, v => { cfg.fov = v; E.transito.definirFOV(v); }, v => `${v}°`);

  $('btnExportar').addEventListener('click', exportarLog);
  $('btnLimpar').addEventListener('click', () => { $('agenteLog').replaceChildren(); $('ticker').textContent = ''; E.alertas.historico.length = 0; E.evidencias = 0; });
  $('btnAnalise').addEventListener('click', () => analiseProfunda('manual'));

  // atalhos de teclado (operador de mesa)
  addEventListener('keydown', ev => {
    if (ev.target.closest('input, select, textarea')) return;
    if (ev.key === 'Escape' && E.zonaEdicao) cancelarZona();
    if (ev.key === 'Enter' && E.zonaEdicao) fecharZona();
    if (ev.key.toLowerCase() === 's' && E.rodando) $('btnSilenciar').click();
  });
}

function aplicarDemo() {
  const padrao = LIMIARES.vigilancia;
  E.vigilancia.ajustar(cfg.demo ? PRESET_DEMO.vigilancia
    : { abandonoS: padrao.abandonoS, permanenciaS: padrao.permanenciaS, remocaoEstaticoMinS: padrao.remocaoEstaticoMinS });
}

// ?debug=1 expõe o estado no console do navegador (diagnóstico de campo)
if (new URLSearchParams(location.search).has('debug')) window.SENTINELA = { E, cfg };

ligarControles();
boot().catch(e => erroBoot(e.message));
