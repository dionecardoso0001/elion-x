/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — orquestrador (navegador)

   Fluxo de um quadro:
     câmera → percepção (MediaPipe) → rastreador → analisador do modo
            → gestor de alertas → sirene / voz / vibração → registro de incidentes
            → agente Sentinela Spy (interpreta, correlaciona, conversa) → HUD + painéis
   Orçamento por modo (o celular não roda tudo a 30 quadros/s):
     SENTINELA  objetos ~16 Hz · pose ~9 Hz
     MOTORISTA  rosto a cada quadro · objetos 2 Hz (só para flagrar celular)
     TRÂNSITO   objetos ~22 Hz
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES, MODELOS, MODELOS_POR_MODO, VERSAO, rotulo, limiaresEfetivos, NOMES_PERFIL } from './config.js';
import { GravadorCampo, ROTULOS_ANOTACAO } from './gravador.js';
import { Rastreador } from './rastreador.js';
import { AnalisadorMotorista, celularJuntoAoRosto } from './motorista.js';
import { AnalisadorTransito } from './transito.js';
import { AnalisadorVigilancia } from './vigilancia.js';
import { GestorAlertas } from './alertas.js';
import { narrar, relatorioSituacao, montarTelemetria } from './agente.js';
import { pedidoInterpretacao, pedidoRelatorio, pedidoDiagnostico, lerResposta, extrairJSON, normalizarInterpretacao, normalizarRelatorio,
  conversar, criarPolitica, custoEstimado, MODELO, ROTULO_RECURSO } from './spy/cerebro.js';
import { ClienteAgente, detectarServidor } from './spy/cliente.js';
import { RegistroIncidentes } from './spy/incidentes.js';
import { Percepcao, abrirCamera, listarCameras, preVoo } from './percepcao.js';
import { Sirene } from './sirene.js';
import { HUD } from './hud.js';

const $ = id => document.getElementById(id);
const agora = () => performance.now();
const NOME_MODO = { sentinela: 'sentinela', motorista: 'motorista', transito: 'trânsito' };
const FALAS_MODO = {
  sentinela: 'Sentinela Spy em operação. Vigilância de perímetro iniciada.',
  motorista: 'Sentinela Spy em operação. Modo motorista. Olhe para a via em postura normal para a calibração.',
  transito: 'Sentinela Spy em operação. Modo trânsito. Monitorando a via à frente.',
};
const ALFABETO = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'ÍNDIA', 'JULIETT', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR'];

/* ── preferências do operador (nunca dado de câmera) ── */
const CHAVE_CFG = 'spy-cfg-v1';
const lerCfg = () => { try { return JSON.parse(localStorage.getItem(CHAVE_CFG)) || {}; } catch { return {}; } };
const cfg = Object.assign({
  modo: 'sentinela', zonas: [], roi: { ...LIMIARES.transito.roi }, fov: LIMIARES.transito.fovHorizontalGraus,
  volume: 0.9, voz: true, poses: true, calor: false, demo: false, gpsMov: true, espelhar: null, nv: false, cameras: {},
  perfil: 'padrao',
}, lerCfg());
// preferências do agente (a CHAVE da API nunca entra aqui — fica em armazenamento separado, ver configurarAgente)
cfg.agente = { modo: null, imagens: true, relatorioMin: 0, lembrar: false, token: '', ...(cfg.agente || {}) };
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
  campo: new GravadorCampo(),   // gravador de CAMPO (métricas para calibração) — não confundir com o de vídeo
  // agente Sentinela Spy
  incidentes: new RegistroIncidentes(), agente: new ClienteAgente(), servidorAgente: { disponivel: false },
  politica: criarPolitica({ intervaloMs: LIMIARES.agente.intervaloAutoMs, porHora: 30 }),
  conversa: [], custo: 0, consultas: 0, bloqueioAteMs: 0, interpretando: 0, relatando: false, perguntando: false,
  ultimoRelatorioIA: Date.now(),
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
  logBoot('run', `SENTINELA SPY v${VERSAO} · inicializando núcleo de visão e agente de IA`);
  const problemas = preVoo();
  if (problemas.length) { problemas.forEach(erroBoot); return; }
  logBoot('ok', 'contexto seguro · câmera disponível · WebAssembly');
  progresso(0.08);

  // o que ESTA instalação tem (gerado por npm run preparar) — vale em servidor próprio e em hospedagem estática
  E.status = await fetch('plataforma.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (E.status) {
    const nModelos = Object.values(E.status.modelos || {}).filter(Boolean).length;
    logBoot('ok', `instalação própria · runtime MediaPipe ${E.status.mediapipe?.versao} · ${nModelos}/3 modelos na própria origem`);
  } else {
    logBoot('aviso', 'instalação sem runtime local (plataforma.json ausente) — usando CDN e modelos do Google');
  }
  const persistente = await E.incidentes.abrir();
  renderIncidentes();
  logBoot(persistente ? 'ok' : 'aviso', persistente
    ? `registro de incidentes · ${E.incidentes.itens.length} no histórico deste aparelho`
    : 'registro de incidentes só em memória (armazenamento do navegador bloqueado)');
  E.servidorAgente = await detectarServidor();
  configurarAgente();
  logBoot(E.agente.pronto ? 'ok' : 'aviso', textoEstadoAgente());

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
  aplicarPerfil();
  E.sirene.manterTelaLigada();
  if (modo !== 'sentinela') iniciarGPS();
  E.rodando = true;
  logAgente({ nivel: 'sistema', texto: `◈ SENTINELA SPY ONLINE — missão ${NOME_MODO[modo].toUpperCase()} · ${$('opCodigo').textContent}` });
  logAgente({ nivel: 'sistema', texto: `◈ ${textoEstadoAgente()}` });
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
  if (E.campo.ativo) {   // uma gravação = uma missão e um conjunto de limiares, senão a análise mistura tudo
    logAgente({ nivel: 'aviso', texto: 'Encerre a gravação de campo antes de trocar de missão.' });
    document.querySelectorAll('.modo-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.modo === E.modo)));
    return;
  }
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
  if (E.campo.ativo) {
    E.campo.amostra(t, saida.metricas);
    if (E.campo.cheio) { logAgente({ nivel: 'aviso', texto: '◈ Gravação de campo atingiu o teto de linhas — encerrada e baixada.' }); encerrarCampo(t); }
  }
  tratarAlertas(saida, t);
}

/* ═════════════════ ALERTAS ═════════════════ */
function tratarAlertas(saida, t) {
  for (const e of saida.eventos) {
    E.campo.evento(t, e);   // o gravador quer o evento BRUTO, antes da supressão de repetição
    const reg = E.alertas.evento(e, t);
    if (reg) {
      const foto = reg.nivel === 'aviso' ? evidencia() : null;
      logAgente(narrar(reg), foto);
      if (reg.nivel !== 'info') registrarIncidente(reg, foto);
    }
  }
  const { novas, escaladas, encerradas } = E.alertas.sincronizar(saida.condicoes, t);
  for (const c of [...novas, ...escaladas]) E.campo.condicao(t, c, 'inicio');
  for (const c of encerradas) E.campo.condicao(t, c, 'fim');
  for (const c of [...novas, ...escaladas]) {
    // quatro animais na pista são UMA ameaça para quem dirige: o registro do
    // gestor guarda cada alvo, mas a tela narra o grupo uma vez a cada 5 s
    const g = c.grupo || c.chave;
    const ult = E.logGrupo.get(g);
    const repetido = ult && t - ult.t < 5000 && ult.nivel === c.nivel;
    E.logGrupo.set(g, { t, nivel: c.nivel });
    if (!repetido) {
      const foto = c.nivel === 'critico' ? evidencia() : null;
      logAgente(narrar(c), foto);
      if (c.nivel !== 'info') {
        const inc = registrarIncidente(c, foto);
        // o agente interpreta sozinho só o CRÍTICO, com intervalo mínimo e teto por hora (custo sob controle)
        if (c.nivel === 'critico' && $('chkAutoAnalise').checked && E.agente.pronto && E.politica.permitir('critico')) interpretar(inc, 'auto');
      }
    }
    if (c.nivel === 'critico') {
      E.sirene.vibrar();
      $('srAlerta').textContent = `${c.titulo}. ${c.detalhe || ''}`;
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
    modo: E.modo, agora: t, nivel, fps: E.fps, infMs: E.infMs, gravando: !!E.gravador, campo: E.campo.ativo,
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

/* ═════════════════ AGENTE SENTINELA SPY ═════════════════
   Interpreta (veredito + divergências), relata (correlação no tempo) e
   conversa (ferramentas que leem a operação). Saída de LLM é dado não
   confiável: entra na tela só por textContent. */
const CHAVE_API = 'spy-chave';
function lerChave() {
  try { return localStorage.getItem(CHAVE_API) || sessionStorage.getItem(CHAVE_API) || ''; } catch { return ''; }
}
function gravarChave(chave, lembrar) {
  try {
    localStorage.removeItem(CHAVE_API); sessionStorage.removeItem(CHAVE_API);
    // padrão: só nesta aba (sessionStorage); "lembrar" grava neste aparelho
    if (chave) (lembrar ? localStorage : sessionStorage).setItem(CHAVE_API, chave);
  } catch { /* armazenamento bloqueado: a chave vive só na memória */ }
}
function configurarAgente() {
  let modo = cfg.agente.modo;
  if (modo === 'servidor' && !E.servidorAgente.disponivel) modo = null;
  if (!modo) modo = E.servidorAgente.disponivel ? 'servidor' : 'navegador';
  E.agente.configurar({ modo, chave: lerChave(), token: cfg.agente.token || '' });
  atualizarSeloAgente();
}
function textoEstadoAgente() {
  if (E.agente.modo === 'servidor') return `agente Sentinela Spy · modo servidor · ${E.servidorAgente.modelo || MODELO}${E.servidorAgente.exigeToken ? ' · exige token' : ''}`;
  return E.agente.chave
    ? `agente Sentinela Spy · chave própria neste aparelho · ${MODELO}`
    : 'agente Sentinela Spy aguardando a chave da API (⚙ no painel do agente) — percepção e alarmes funcionam sem ele';
}
function atualizarSeloAgente(txt) {
  $('agenteStatus').textContent = txt || (E.agente.pronto ? (E.agente.modo === 'servidor' ? 'SERVIDOR' : 'CHAVE PRÓPRIA') : 'SEM CHAVE');
  $('agenteCusto').textContent = `${E.consultas} consulta(s) · ~US$ ${E.custo.toFixed(3)} nesta sessão (estimativa)`;
}
function contabilizar(uso) { E.consultas++; E.custo += custoEstimado(uso || {}); atualizarSeloAgente(); }
function agenteBloqueado() {
  if (!E.agente.pronto) {
    logAgente({ nivel: 'aviso', texto: 'Agente sem chave: abra ⚙ CONFIGURAR e informe a chave da API — ou rode o servidor próprio com ANTHROPIC_API_KEY.' });
    return true;
  }
  if (Date.now() < E.bloqueioAteMs) {
    logAgente({ nivel: 'aviso', texto: `Agente em pausa pelo limite de uso da API — volta em ${Math.ceil((E.bloqueioAteMs - Date.now()) / 1000)} s.` });
    return true;
  }
  return false;
}
function tratarErroAgente(e, oque) {
  if (e?.status === 429) E.bloqueioAteMs = Date.now() + 1000 * (e.tentarEmS || 30);
  const msg = e?.name === 'TimeoutError' ? 'sem resposta em 2 minutos' : e?.message || 'falha desconhecida';
  logAgente({ nivel: 'aviso', texto: `Agente: ${oque} falhou — ${msg}` });
  if (e?.status === 401) atualizarSeloAgente('CHAVE RECUSADA');
}
const telemetriaAgora = () => montarTelemetria({
  modo: E.modo, defcon: E.alertas.defcon(agora()), ativas: E.alertas.listaAtivas(),
  historico: E.alertas.historico, trilhas: E.trilhas, metricas: E.saida?.metricas, zonas: cfg.zonas,
});
const quadroParaAgente = () => (cfg.agente.imagens ? quadroJPEG(LIMIARES.agente.larguraQuadro, LIMIARES.agente.qualidadeJpeg) : null);
function avisarAjuste(recurso) {
  logAgente({ nivel: 'aviso', texto: `A API recusou o ${ROTULO_RECURSO[recurso] || recurso} nesta conta — o agente segue sem ele (o resto funciona igual).` });
}
E.agente.aoAjuste = avisarAjuste;   // modo chave própria
async function enviarAgente(tipo, msgs) {
  const msg = await E.agente.enviar(tipo, msgs, { signal: AbortSignal.timeout(120000) });
  for (const r of msg?._ajustes || []) avisarAjuste(r);   // modo servidor
  return msg;
}

/** Teste de conexão REAL: chamada mínima com os mesmos recursos das tarefas (modelo, fallback, saída estruturada). */
async function testarAgente() {
  if (!E.agente.pronto) { agenteBloqueado(); return; }
  const b = $('btnTestarAgente');
  b.disabled = true; atualizarSeloAgente('TESTANDO…');
  const t0 = performance.now();
  try {
    const msg = await enviarAgente('diagnostico', pedidoDiagnostico());
    const ms = performance.now() - t0;
    const r = lerResposta(msg);
    contabilizar(r.uso);
    if (r.recusa) { logAgente({ nivel: 'aviso', texto: '◎ TESTE DO AGENTE: a chamada chegou, mas o modelo recusou responder.' }); return; }
    const j = extrairJSON(r.texto);
    const ok = j?.status === 'ok';
    logAgente({ nivel: ok ? 'agente' : 'aviso',
      texto: `◎ TESTE DO AGENTE: ${ok ? 'OPERACIONAL' : 'resposta fora do formato'} · ${r.modelo || '?'} respondeu em ${(ms / 1000).toFixed(1)} s`
        + ` · modo ${E.agente.modo === 'servidor' ? 'servidor' : 'chave própria'} · ${r.uso?.input_tokens ?? '?'}+${r.uso?.output_tokens ?? '?'} tokens`
        + ` · ~US$ ${custoEstimado(r.uso).toFixed(4)}${r.fallback ? ' · atendido pelo fallback' : ''}${ok && j.mensagem ? ` — "${String(j.mensagem).slice(0, 120)}"` : ''}` });
  } catch (e) { tratarErroAgente(e, 'o teste de conexão'); }
  finally { b.disabled = false; atualizarSeloAgente(); }
}

function registrarIncidente(x, foto) {
  return E.incidentes.registrar({
    modo: E.modo, chave: x.chave ?? x.tipo ?? null, nivel: x.nivel, titulo: x.titulo,
    detalhe: x.detalhe ?? null, alvo: x.alvo ?? null, foto,
  });
}

const VEREDITO = { anomalia_confirmada: 'ANOMALIA CONFIRMADA', provavel_falso_alarme: 'PROVÁVEL FALSO ALARME', inconclusivo: 'INCONCLUSIVO' };

/** Interpreta um incidente (ou, sem incidente, uma varredura sob demanda). */
async function interpretar(inc, origem = 'manual') {
  if (agenteBloqueado() || E.interpretando >= 2) return;
  if (!inc) inc = E.incidentes.registrar({ modo: E.modo, chave: 'consulta', nivel: 'info', titulo: 'Varredura sob demanda do operador', foto: evidencia() });
  const jpeg = quadroParaAgente();
  E.interpretando++;
  atualizarSeloAgente('INTERPRETANDO…'); $('btnInterpretar').disabled = true;
  logAgente({ nivel: 'sistema', texto: `◈ ${origem === 'auto' ? 'Evento crítico — ' : ''}Sentinela Spy interpretando "${inc.titulo}"${jpeg ? ' com 1 quadro' : ' só pela telemetria'}…` });
  try {
    const msg = await enviarAgente('interpretar', pedidoInterpretacao({
      incidente: RegistroIncidentes.resumo(inc), telemetria: telemetriaAgora(), imagemB64: jpeg ? jpeg.split(',')[1] : null,
    }));
    const r = lerResposta(msg);
    contabilizar(r.uso);
    if (r.recusa) { logAgente({ nivel: 'aviso', texto: `O agente recusou interpretar este quadro${r.categoria ? ` (${r.categoria})` : ''}.` }); return; }
    const p = normalizarInterpretacao(extrairJSON(r.texto));
    E.incidentes.anexarParecer(inc.id, { ...p, em: Date.now(), modelo: r.modelo, origem, fallback: r.fallback });
    mostrarParecer(p, r);
    logAgente({
      nivel: ['alto', 'critico'].includes(p.nivel_risco) ? 'critico' : 'agente',
      texto: `◈ SENTINELA SPY [${VEREDITO[p.veredito]} · risco ${p.nivel_risco}]: ${p.resumo}`,
      protocolo: p.acao_recomendada ? `AÇÃO: ${p.acao_recomendada}` : null,
    });
    if (origem === 'manual' && E.modo !== 'motorista') E.sirene.falar(p.resumo);
  } catch (e) { tratarErroAgente(e, 'a interpretação'); }
  finally { E.interpretando--; $('btnInterpretar').disabled = false; atualizarSeloAgente(); }
}

/** Relatório de situação: correlaciona os incidentes da janela. */
async function relatorioAgente(origem = 'manual') {
  if (E.relatando || agenteBloqueado()) return;
  const janelaMin = cfg.agente.relatorioMin || 30;
  E.relatando = true; E.ultimoRelatorioIA = Date.now();
  atualizarSeloAgente('RELATANDO…'); $('btnRelatorio').disabled = true;
  try {
    const incidentes = E.incidentes.listar({ minutos: janelaMin, limite: 50 }).map(RegistroIncidentes.resumo);
    const msg = await enviarAgente('relatorio', pedidoRelatorio({ telemetria: telemetriaAgora(), incidentes, janelaMin }));
    const r = lerResposta(msg);
    contabilizar(r.uso);
    if (r.recusa) { logAgente({ nivel: 'aviso', texto: 'O agente recusou produzir o relatório.' }); return; }
    const rel = normalizarRelatorio(extrairJSON(r.texto));
    mostrarRelatorio(rel, r, janelaMin);
    logAgente({ nivel: ['alto', 'critico'].includes(rel.nivel_risco) ? 'critico' : 'agente',
      texto: `◈ RELATÓRIO SENTINELA SPY (${janelaMin} min · ${incidentes.length} incidente(s) · risco ${rel.nivel_risco}): ${rel.resumo}` });
  } catch (e) { tratarErroAgente(e, 'o relatório'); }
  finally { E.relatando = false; $('btnRelatorio').disabled = false; atualizarSeloAgente(); }
}

/* ── conversa com o operador (ferramentas executadas AQUI, lendo a operação) ── */
const ROTULO_FERRAMENTA = {
  consultar_incidentes: 'consultando o registro de incidentes…',
  estado_atual: 'lendo a telemetria deste instante…',
  capturar_quadro: 'capturando o quadro da câmera…',
};
async function executarFerramenta(nome, entrada) {
  if (nome === 'consultar_incidentes') {
    const minutos = Math.max(1, Math.min(1440, Number(entrada.minutos) || 60));
    const limite = Math.max(1, Math.min(50, Number(entrada.limite) || 20));
    const nivel = ['todos', 'critico', 'aviso', 'info'].includes(entrada.nivel) ? entrada.nivel : 'todos';
    const itens = E.incidentes.listar({ minutos, limite, nivel }).map(RegistroIncidentes.resumo);
    return JSON.stringify({ janela_min: minutos, filtro: nivel, devolvidos: itens.length, incidentes: itens });
  }
  if (nome === 'estado_atual') {
    return JSON.stringify({ ...telemetriaAgora(), operacao_ativa: E.rodando, pausado: E.pausado,
      situacao: relatorioSituacao(E.modo, E.saida?.metricas, E.alertas.defcon(agora())) });
  }
  if (nome === 'capturar_quadro') {
    if (!cfg.agente.imagens) throw new Error('o operador desativou o envio de imagens ao agente');
    const jpeg = quadroJPEG(LIMIARES.agente.larguraQuadro, LIMIARES.agente.qualidadeJpeg);
    if (!jpeg) throw new Error('a câmera ainda não tem quadro disponível');
    return [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.split(',')[1] } },
      { type: 'text', text: `quadro capturado às ${new Date().toTimeString().slice(0, 8)}` },
    ];
  }
  throw new Error(`ferramenta desconhecida: ${nome}`);
}
const imagensNaConversa = () => E.conversa.reduce((n, m) => n + (Array.isArray(m.content)
  ? m.content.reduce((k, b) => k + (b.type === 'image' ? 1 : 0) + (Array.isArray(b.content) ? b.content.filter(x => x.type === 'image').length : 0), 0) : 0), 0);

async function perguntar(texto) {
  texto = String(texto || '').trim().slice(0, 2000);
  if (!texto || E.perguntando || agenteBloqueado()) return;
  // limite da conversa: começa outra em vez de cortar o histórico (histórico editado invalida o pensamento do modelo)
  if (E.conversa.length > 56 || imagensNaConversa() > 20) {
    E.conversa = [];
    logAgente({ nivel: 'sistema', texto: '◈ Conversa longa: iniciei uma nova. O registro de incidentes continua disponível ao agente.' });
  }
  E.perguntando = true; $('btnPerguntar').disabled = true; atualizarSeloAgente('PENSANDO…');
  logAgente({ nivel: 'operador', texto: `◇ VOCÊ: ${texto}` });
  try {
    const r = await conversar({
      historico: E.conversa, pergunta: texto, enviar: enviarAgente, executar: executarFerramenta,
      aoEtapa: nome => logAgente({ nivel: 'info', texto: `· ${ROTULO_FERRAMENTA[nome] || nome}` }),
    });
    r.usos.forEach(contabilizar);
    if (r.recusa) { logAgente({ nivel: 'aviso', texto: 'O agente recusou responder a esta pergunta.' }); return; }
    E.conversa = r.mensagens;   // apenas acrescenta
    logAgente({ nivel: 'agente', texto: `◈ SENTINELA SPY: ${r.texto || '(sem texto)'}${r.truncado ? ' [resposta cortada]' : ''}` });
    if (E.modo !== 'motorista' && $('chkFalarResposta').checked) E.sirene.falar(r.texto.slice(0, 300));
  } catch (e) { tratarErroAgente(e, 'a resposta'); }
  finally { E.perguntando = false; $('btnPerguntar').disabled = false; atualizarSeloAgente(); }
}

/** Parecer do agente — SÓ textContent: saída de LLM é dado não confiável. */
function el(tag, cls, txt) { const x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }
function blocoLista(card, titulo, itens, cls) {
  if (!itens?.length) return;
  card.append(el('b', null, titulo));
  const ul = el('ul');
  itens.forEach(i => ul.append(el('li', cls, i)));
  card.append(ul);
}
function mostrarParecer(p, r) {
  const card = $('analiseCard');
  card.replaceChildren();
  const h3 = el('h3', null, 'PARECER SENTINELA SPY');
  h3.append(el('span', `veredito ${p.veredito}`, VEREDITO[p.veredito]), el('span', `risco ${p.nivel_risco}`, `RISCO ${p.nivel_risco.toUpperCase()}`));
  card.append(h3, el('p', null, p.resumo));
  if (p.interpretacao) card.append(el('p', 'interp', p.interpretacao));
  blocoLista(card, 'Evidências', p.evidencias);
  blocoLista(card, 'Hipóteses alternativas', p.hipoteses_alternativas);
  blocoLista(card, 'Divergências com o detector local', p.divergencias, 'div');
  if (p.acao_recomendada) card.append(el('p', 'acao', `AÇÃO: ${p.acao_recomendada}`));
  card.append(el('small', null, `confiança ${p.confianca} · ${r.modelo || MODELO}${r.fallback ? ' (fallback)' : ''}`));
  card.hidden = false;
}
function mostrarRelatorio(rel, r, janelaMin) {
  const card = $('analiseCard');
  card.replaceChildren();
  const h3 = el('h3', null, `RELATÓRIO · ${janelaMin} MIN`);
  h3.append(el('span', `risco ${rel.nivel_risco}`, `RISCO ${rel.nivel_risco.toUpperCase()}`));
  card.append(h3, el('p', null, rel.resumo));
  blocoLista(card, 'Padrões', rel.padroes);
  blocoLista(card, 'Pontos de atenção', rel.pontos_de_atencao, 'div');
  blocoLista(card, 'Recomendações', rel.recomendacoes);
  card.append(el('small', null, `${r.modelo || MODELO}${r.fallback ? ' (fallback)' : ''}`));
  card.hidden = false;
}

/* ── registro de incidentes (painel) ── */
const NIVEL_ROTULO = { critico: '▲ CRÍTICO', aviso: '◆ AVISO', info: '· INFO' };
function renderIncidentes() {
  const itens = E.incidentes.listar({ minutos: 1440, limite: 30 });
  const ol = $('listaIncidentes');
  ol.replaceChildren(...itens.map(x => {
    const li = el('li', x.nivel);
    li.append(el('time', null, new Date(x.em).toTimeString().slice(0, 8)), el('span', `chip ${x.nivel}`, NIVEL_ROTULO[x.nivel] || x.nivel), el('span', 'tit', x.titulo));
    if (x.parecer) li.append(el('span', `veredito ${x.parecer.veredito}`, VEREDITO[x.parecer.veredito] || x.parecer.veredito));
    return li;
  }));
  const total = E.incidentes.itens.length;
  $('incResumo').textContent = total
    ? `${total} incidente(s) neste aparelho${E.incidentes.persistente ? '' : ' (só em memória)'} · exibindo os ${itens.length} mais recentes das últimas 24 h`
    : 'Nenhum incidente ainda. Alertas de aviso e críticos entram aqui automaticamente, com o parecer do agente quando houver.';
}

/* ── configurações do agente ── */
function abrirConfigAgente() {
  const srv = E.servidorAgente;
  $('optServidor').disabled = !srv.disponivel;
  $('infoServidor').textContent = srv.disponivel ? `disponível · ${srv.modelo}${srv.exigeToken ? ' · exige token' : ''}` : 'indisponível nesta hospedagem';
  const modo = document.querySelector(`input[name="modoAgente"][value="${E.agente.modo}"]`);
  if (modo) modo.checked = true;
  $('inpChave').value = '';
  $('inpChave').placeholder = E.agente.chave ? 'chave salva — deixe em branco para manter' : 'sk-ant-…';
  $('chkLembrarChave').checked = !!cfg.agente.lembrar;
  $('chkApagarChave').checked = false;
  $('inpToken').value = cfg.agente.token || '';
  $('chkImagens').checked = cfg.agente.imagens !== false;
  $('selRelatorio').value = String(cfg.agente.relatorioMin || 0);
  $('cfgErro').hidden = true;
  $('dlgAgente').showModal();
}
function salvarConfigAgente(ev) {
  ev.preventDefault();
  const modo = document.querySelector('input[name="modoAgente"]:checked')?.value || 'navegador';
  const nova = $('inpChave').value.trim();
  if (nova && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(nova)) {
    $('cfgErro').textContent = 'Isso não parece uma chave da API da Anthropic (começa com sk-ant-). Confira no Console da Anthropic, em API Keys.';
    $('cfgErro').hidden = false; return;
  }
  const lembrar = $('chkLembrarChave').checked;
  const chave = $('chkApagarChave').checked ? '' : (nova || E.agente.chave);
  cfg.agente = { ...cfg.agente, modo, lembrar, token: $('inpToken').value.trim(), imagens: $('chkImagens').checked,
    relatorioMin: Number($('selRelatorio').value) || 0 };
  gravarChave(chave, lembrar);
  salvarCfg();
  E.agente.configurar({ modo, chave, token: cfg.agente.token });
  E.ultimoRelatorioIA = Date.now();
  $('dlgAgente').close();
  atualizarSeloAgente();
  logAgente({ nivel: 'sistema', texto: `◈ ${textoEstadoAgente()}` });
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
    if (cfg.demo) add('preset', 'DEMONSTRAÇÃO — tempos encurtados', 'aviso', true);
  }
  add('perfil de sensibilidade', NOMES_PERFIL[cfg.perfil] || 'PADRÃO', cfg.perfil === 'padrao' ? '' : 'aviso', true);
  if (E.campo.ativo) {
    const s = Math.floor(E.campo.duracaoMs(t) / 1000), c = E.campo.contagem;
    add('gravação de campo', `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} · ${c.amostras} amostras · ${c.condicoes} alerta(s) · ${c.anotacoes} anotação(ões)`, 'aviso', true);
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

  // relatório periódico do AGENTE (opcional, em minutos)
  if (cfg.agente.relatorioMin > 0 && E.agente.pronto && !E.relatando && Date.now() - E.ultimoRelatorioIA >= cfg.agente.relatorioMin * 60000) {
    relatorioAgente('auto');
  }
  // relatório de situação periódico (local, sem rede)
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
/* Desenho de zona — ponteiro OU teclado (WCAG 2.1.1). Durante a edição o visor
   vira um widget focável (role=application) com cursor próprio; fora dela, o
   canvas volta a ser decorativo (aria-hidden) e sai da ordem de tabulação. */
const ROTULO_EDITOR = 'Editor de zona. Setas movem o cursor (Shift: ajuste fino), Espaço marca o vértice, '
  + 'Backspace desfaz o último, Enter fecha a zona, Esc cancela.';
const anunciar = txt => { $('srInfo').textContent = txt; };
const pct = v => `${Math.round(v * 100)}%`;
function iniciarZona() {
  E.zonaEdicao = { tipo: $('selTipoZona').value, pontos: [], cursor: { x: 0.5, y: 0.5 } };
  document.body.classList.add('editando');
  $('edicaoZona').hidden = false; $('dicaZona').hidden = false;
  const hud = $('hud');
  hud.removeAttribute('aria-hidden');
  hud.setAttribute('role', 'application'); hud.setAttribute('tabindex', '0'); hud.setAttribute('aria-label', ROTULO_EDITOR);
  hud.focus({ preventScroll: true });
}
function cancelarZona() { if (encerrarEdicaoZona()) anunciar('Edição de zona cancelada.'); }
/** Sai do modo de edição e restaura o visor decorativo. Devolve se havia edição aberta. */
function encerrarEdicaoZona() {
  const estava = !!E.zonaEdicao, hud = $('hud'), foco = document.activeElement;
  E.zonaEdicao = null;
  clearTimeout(E.tAnuncioCursor);
  document.body.classList.remove('editando');
  $('edicaoZona').hidden = true; $('dicaZona').hidden = true;
  hud.setAttribute('aria-hidden', 'true');
  for (const a of ['role', 'tabindex', 'aria-label']) hud.removeAttribute(a);
  // devolve o foco só se ele estava no editor (ou se perderia num botão que acabou de sumir);
  // trocar de missão pela aba não deve arrancar o foco da aba
  if (estava && (foco === hud || foco === document.body || $('edicaoZona').contains(foco))) $('btnZona').focus({ preventScroll: true });
  return estava;
}
function fecharZona() {
  const z = E.zonaEdicao;
  if (!z || z.pontos.length < 3) {
    const msg = `Uma zona precisa de pelo menos 3 vértices${z ? ` — marcados: ${z.pontos.length}` : ''}.`;
    logAgente({ nivel: 'aviso', texto: msg }); anunciar(msg); return;
  }
  const usados = new Set(cfg.zonas.map(x => x.nome));
  const nome = ALFABETO.find(n => !usados.has(n)) || `Z${cfg.zonas.length + 1}`;
  cfg.zonas.push({ id: `z${Date.now().toString(36)}`, nome, tipo: z.tipo, pontos: z.pontos });
  salvarCfg(); renderZonas(); encerrarEdicaoZona();
  const tipo = z.tipo === 'restrita' ? 'acesso restrito' : 'monitorado';
  logAgente({ nivel: 'sistema', texto: `◈ PERÍMETRO ${nome} estabelecido (${tipo})` });
  anunciar(`Zona ${nome} criada com ${z.pontos.length} vértices (${tipo}).`);
}
/** Teclado do editor de zona. Devolve true quando a tecla foi consumida. */
function teclaEditorZona(ev) {
  const z = E.zonaEdicao, c = z.cursor;
  const passo = ev.shiftKey ? 0.005 : 0.02;
  const sx = E.hud?.espelhar ? -1 : 1;   // visor espelhado: → continua indo para a direita NA TELA
  const mov = { ArrowLeft: [-sx, 0], ArrowRight: [sx, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (mov) {
    c.x = Math.min(1, Math.max(0, c.x + mov[0] * passo));
    c.y = Math.min(1, Math.max(0, c.y + mov[1] * passo));
    // anuncia a posição só quando o operador para de mover (evita fala a cada tecla)
    clearTimeout(E.tAnuncioCursor);
    E.tAnuncioCursor = setTimeout(() => anunciar(`Cursor em ${pct(E.hud?.espelhar ? 1 - c.x : c.x)} da largura, ${pct(c.y)} da altura.`), 400);
    return true;
  }
  clearTimeout(E.tAnuncioCursor);         // a confirmação de vértice não pode ser atropelada pela posição
  if (ev.key === ' ') {
    z.pontos.push({ x: c.x, y: c.y });
    anunciar(`Vértice ${z.pontos.length} marcado.${z.pontos.length >= 3 ? ' Enter fecha a zona.' : ''}`);
    return true;
  }
  if (ev.key === 'Backspace' || ev.key === 'Delete') {
    if (z.pontos.pop()) anunciar(`Último vértice removido — restam ${z.pontos.length}.`);
    return true;
  }
  if (ev.key === 'Enter') { fecharZona(); return true; }
  return false;
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
    sistema: `SENTINELA SPY v${VERSAO}`, exportado_em: new Date().toISOString(), modo: E.modo,
    zonas: cfg.zonas.map(z => ({ nome: z.nome, tipo: z.tipo, pontos: z.pontos })),
    eventos: E.alertas.historico.map(e => ({ instante_ms: Math.round(e.t), tipo: e.tipo, nivel: e.nivel, titulo: e.titulo, detalhe: e.detalhe ?? null, alvo: e.alvo ?? null })),
  };
  baixar(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }), `sentinela-log-${carimbo()}.json`);
}

/* ═════════════════ CONTROLES ═════════════════ */
function ligarControles() {
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
    if (p) { E.zonaEdicao.pontos.push(p); E.zonaEdicao.cursor = { ...p }; }
  });
  const chk = (id, chave, aoMudar) => {
    const c = $(id); c.checked = !!cfg[chave];
    c.addEventListener('change', () => { cfg[chave] = c.checked; salvarCfg(); aoMudar?.(); });
  };
  chk('chkPoses', 'poses');
  chk('chkCalor', 'calor');
  chk('chkDemo', 'demo', aplicarPerfil);
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
  // agente Sentinela Spy
  $('btnInterpretar').addEventListener('click', () => interpretar(null, 'manual'));
  $('btnRelatorio').addEventListener('click', () => relatorioAgente('manual'));
  $('btnConfigAgente').addEventListener('click', abrirConfigAgente);
  $('btnTestarAgente').addEventListener('click', testarAgente);
  $('formAgente').addEventListener('submit', salvarConfigAgente);
  $('btnCancelarAgente').addEventListener('click', () => $('dlgAgente').close());
  $('formChat').addEventListener('submit', ev => { ev.preventDefault(); const t = $('txtPergunta').value; $('txtPergunta').value = ''; perguntar(t); });
  $('btnNovaConversa').addEventListener('click', () => { E.conversa = []; logAgente({ nivel: 'sistema', texto: '◈ Nova conversa com o agente.' }); });
  // registro de incidentes
  E.incidentes.aoMudar(() => renderIncidentes());
  renderIncidentes();
  $('btnExportarInc').addEventListener('click', () => baixar(new Blob([E.incidentes.exportar()], { type: 'application/json' }), `sentinela-spy-incidentes-${carimbo()}.json`));
  const limpar = $('btnLimparInc');
  limpar.addEventListener('click', async () => {
    if (limpar.dataset.confirmar !== '1') {   // confirmação em dois toques, na própria página
      limpar.dataset.confirmar = '1'; limpar.textContent = '⚠ CONFIRMAR: APAGAR TODOS';
      setTimeout(() => { limpar.dataset.confirmar = ''; limpar.textContent = '✕ LIMPAR REGISTRO'; }, 4000);
      return;
    }
    limpar.dataset.confirmar = ''; limpar.textContent = '✕ LIMPAR REGISTRO';
    await E.incidentes.limpar();
    logAgente({ nivel: 'sistema', texto: '◈ Registro de incidentes apagado deste aparelho.' });
  });

  // atalhos de teclado (operador de mesa)
  addEventListener('keydown', ev => {
    if (ev.target.closest('input, select, textarea')) return;
    if (E.zonaEdicao) {
      if (ev.key === 'Escape') { ev.preventDefault(); cancelarZona(); return; }
      // Enter/Espaço num botão são do botão: antes, Enter em "✕ CANCELAR" salvava a zona e depois cancelava
      const noVisor = ev.target === $('hud') || ev.target === document.body;
      if (noVisor && !ev.ctrlKey && !ev.metaKey && !ev.altKey && teclaEditorZona(ev)) { ev.preventDefault(); return; }
    }
    // atalhos de uma letra não disparam com modificador: Ctrl+F (buscar), Ctrl+P (imprimir) e
    // Ctrl+V (colar) gravavam anotações falsas de campo durante uma sessão
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
    const k = ev.key.toLowerCase();
    if (k === 's' && E.rodando) $('btnSilenciar').click();
    const atalho = { v: 'verdadeiro', f: 'falso_alarme', p: 'perdeu', m: 'marca' }[k];
    if (atalho && E.campo.ativo) anotar(atalho);
  });

  // ── calibração de campo ──
  const selPerfil = $('selPerfil');
  selPerfil.value = cfg.perfil in NOMES_PERFIL ? cfg.perfil : 'padrao';
  selPerfil.addEventListener('change', () => {
    cfg.perfil = selPerfil.value; salvarCfg(); aplicarPerfil();
    logAgente({ nivel: 'sistema', texto: `◈ Perfil de sensibilidade: ${NOMES_PERFIL[cfg.perfil]}` });
  });
  $('btnCampo').addEventListener('click', () => (E.campo.ativo ? encerrarCampo(agora()) : iniciarCampo(agora())));
  document.querySelectorAll('#anotacoes [data-rotulo]').forEach(b => b.addEventListener('click', () => anotar(b.dataset.rotulo)));
}

/** Perfil de sensibilidade + preset de demonstração → limiares efetivos dos três analisadores. */
function aplicarPerfil() {
  E.motorista.ajustar(limiaresEfetivos('motorista', cfg.perfil));
  E.transito.ajustar(limiaresEfetivos('transito', cfg.perfil));
  E.vigilancia.ajustar(limiaresEfetivos('sentinela', cfg.perfil, { demo: cfg.demo }));
}

function iniciarCampo(t) {
  if (!E.rodando) { logAgente({ nivel: 'aviso', texto: 'Inicie a operação antes de gravar uma sessão de campo.' }); return; }
  const v = $('video');
  E.campo.iniciar({
    t, modo: E.modo, perfil: cfg.perfil, demo: E.modo === 'sentinela' && cfg.demo,
    limiares: limiaresEfetivos(E.modo, cfg.perfil, { demo: cfg.demo }),
    dispositivo: { navegador: navigator.userAgent.slice(0, 140), quadro: `${v.videoWidth}x${v.videoHeight}`,
      delegado: E.percepcao?.backend, runtime: E.percepcao?.fonte, fps: E.fps },
  });
  // alerta que JÁ está soando entra no instante zero: começar a gravar no meio de um alarme
  // é justamente o caso que o operador quer rotular (falha real vista no teste E2E)
  for (const c of E.alertas.listaAtivas()) E.campo.condicao(t, c, 'inicio', { pre_existente: true });
  estadoCampo(true);
  logAgente({ nivel: 'sistema', texto: `◈ GRAVAÇÃO DE CAMPO iniciada — missão ${NOME_MODO[E.modo].toUpperCase()}, perfil ${NOMES_PERFIL[cfg.perfil]}. Anote: V correto · F falso · P perdido · M marca.` });
}

function encerrarCampo(t) {
  const texto = E.campo.parar(t);
  estadoCampo(false);
  if (!texto) return;
  const c = E.campo.contagem;
  baixar(new Blob([texto], { type: 'application/x-ndjson' }), `sentinela-campo-${E.modo}-${carimbo()}.jsonl`);
  logAgente({ nivel: 'sistema', texto: `◈ Sessão de campo salva neste aparelho: ${c.amostras} amostras, ${c.condicoes} registro(s) de alerta, ${c.anotacoes} anotação(ões). Analise com npm run avaliar.` });
}

function estadoCampo(ativo) {
  const b = $('btnCampo');
  b.setAttribute('aria-pressed', String(ativo));
  b.textContent = ativo ? '■ ENCERRAR E BAIXAR SESSÃO' : '◉ INICIAR GRAVAÇÃO DE CAMPO';
  $('anotacoes').hidden = !ativo;
  $('ctlCampo').classList.toggle('gravando', ativo);
  $('campoSelo').textContent = ativo ? '● GRAVANDO' : 'PARADA';
  $('selPerfil').disabled = ativo;   // trocar limiares no meio da sessão invalidaria a análise
  document.querySelectorAll('.modo-tab').forEach(x => { x.disabled = ativo && x.dataset.modo !== E.modo; });
}

function anotar(rotulo) {
  const a = E.campo.anotacao(agora(), rotulo);
  if (!a) return;
  E.sirene.vibrar([40]);
  const vinculo = a.alvo ? ` → ${a.alvo_titulo} (há ${(a.alvo_ha_ms / 1000).toFixed(1)} s)` : '';
  logAgente({ nivel: 'sistema', texto: `◈ ANOTAÇÃO: ${ROTULOS_ANOTACAO[rotulo]}${vinculo}` });
}

// ?debug=1 expõe o estado no console do navegador (diagnóstico de campo)
if (new URLSearchParams(location.search).has('debug')) window.SPY = { E, cfg };

ligarControles();
boot().catch(e => erroBoot(e.message));
