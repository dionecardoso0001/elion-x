/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — percepção (navegador): runtime MediaPipe + modelos

   Ordem de origem do runtime: a PRÓPRIA plataforma (dependência npm
   fixada, copiada para vendor/mediapipe/<versão>/ por npm run preparar) e, só se ela não
   existir, o CDN na mesma versão exata. Rede corporativa bloqueia CDN
   com frequência — foi o que aconteceu no ambiente onde este módulo foi
   construído — e a plataforma não pode morrer por isso.

   Modelos: cache-first no Cache Storage do navegador, com impressão
   digital SHA-256 conferida em TODA carga (inclusive do cache: cache
   corrompido é tão perigoso quanto download adulterado). Depois da
   primeira carga, o modo motorista abre sem rede — o celular no carro
   pode perder sinal no meio da estrada.

   Delegado: GPU (WebGL2) primeiro; se o aparelho recusar, CPU. O rodapé
   mostra qual dos dois está rodando, para ninguém atribuir a lentidão à
   coisa errada.
   ═══════════════════════════════════════════════════════════════════════ */
import { MODELOS, MEDIAPIPE_VERSAO, MEDIAPIPE_CDN, LIMIARES } from './config.js';

const CACHE_MODELOS = 'spy-modelos-v1';

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}

/** Download com progresso (o arquivo de 7 MB num 4G precisa mostrar que está andando). */
async function baixar(url, esperado, aoProgresso) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tipo = r.headers.get('content-type') || '';
  if (tipo.includes('text/html')) throw new Error('resposta HTML no lugar do modelo');
  const total = Number(r.headers.get('content-length')) || esperado || 0;
  if (!r.body || !r.body.getReader) {
    const b = new Uint8Array(await r.arrayBuffer());
    aoProgresso?.(1);
    return b;
  }
  const leitor = r.body.getReader();
  const partes = [];
  let lido = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value); lido += value.length;
    if (total) aoProgresso?.(Math.min(1, lido / total));
  }
  const buf = new Uint8Array(lido);
  let o = 0;
  for (const p of partes) { buf.set(p, o); o += p.length; }
  return buf;
}

/**
 * WebGL servido por RASTERIZADOR DE SOFTWARE (SwiftShader, llvmpipe) — comum em
 * máquina virtual, desktop remoto e GPU bloqueada pelo navegador. Medido no
 * ambiente de construção deste módulo: o "GPU" por software levou ~1.500 ms por
 * inferência contra ~170 ms na CPU. Nesse caso a CPU é a escolha certa.
 */
export function gpuPorSoftware() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'sem WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render driver/i.test(r) ? r : null;
  } catch { return null; }
}

export class Percepcao {
  constructor({ status = null, aoLog = () => {} } = {}) {
    this.status = status;
    this.log = aoLog;
    const q = new URLSearchParams(location.search);
    const soft = q.has('gpu') ? null : gpuPorSoftware();
    this.soCPU = q.has('cpu') || !!soft;
    if (soft && !q.has('cpu')) aoLog('aviso', `GPU por software detectada (${soft.slice(0, 60)}) — delegado CPU, que é mais rápido neste aparelho`);
    this.mp = null; this.fileset = null; this.fonte = null;
    this.tarefas = {};      // chave → instância MediaPipe
    this.backend = {};      // chave → 'GPU' | 'CPU'
    this.ultimoTs = {};     // chave → último timestamp (precisa ser estritamente crescente)
    this.carregando = {};
  }

  /** Carrega o runtime de visão (bundle ESM + fileset WASM). */
  async iniciarRuntime() {
    const fontes = [];
    const mpLocal = this.status?.mediapipe;
    if (mpLocal?.local) fontes.push({ base: new URL(`vendor/mediapipe/${mpLocal.versao}`, location.href).href.replace(/\/$/, ''), rotulo: `origem local v${mpLocal.versao}` });
    fontes.push({ base: MEDIAPIPE_CDN, rotulo: `CDN jsDelivr v${MEDIAPIPE_VERSAO}` });
    const erros = [];
    for (const f of fontes) {
      try {
        const mp = await import(`${f.base}/vision_bundle.mjs`);
        const fileset = await mp.FilesetResolver.forVisionTasks(`${f.base}/wasm`);
        this.mp = mp; this.fileset = fileset; this.fonte = f.rotulo;
        return f.rotulo;
      } catch (e) {
        erros.push(`${f.rotulo}: ${e.message}`);
        this.log('aviso', `runtime indisponível em ${f.rotulo} — tentando a próxima origem`);
      }
    }
    throw new Error('runtime de visão indisponível. ' + erros.join(' · '));
  }

  /** Bytes do modelo: cache → origem local → Google, sempre com SHA-256 conferido. */
  async obterModelo(chave, aoProgresso) {
    const m = MODELOS[chave];
    let cache = null;
    try { cache = await caches.open(CACHE_MODELOS); } catch { /* sem Cache Storage: segue pela rede */ }
    if (cache) {
      try {
        const r = await cache.match(m.url);
        if (r) {
          const buf = new Uint8Array(await r.arrayBuffer());
          if ((await sha256(buf)) === m.sha256) { aoProgresso?.(1); return { buf, origem: 'cache' }; }
          await cache.delete(m.url);   // corrompido: descarta e baixa de novo
          this.log('aviso', `cache de ${m.arquivo} corrompido — descartado`);
        }
      } catch { /* cache ilegível: rede */ }
    }
    const urls = [];
    if (this.status?.modelos?.[chave]) urls.push({ url: new URL(`modelos/${m.arquivo}`, location.href).href, origem: 'local' });
    urls.push({ url: m.url, origem: 'google' });
    const erros = [];
    for (const u of urls) {
      try {
        const buf = await baixar(u.url, m.bytes, aoProgresso);
        const h = await sha256(buf);
        if (h !== m.sha256) throw new Error(`SHA-256 divergente (${h.slice(0, 12)}… ≠ ${m.sha256.slice(0, 12)}…) — modelo RECUSADO`);
        if (cache) cache.put(m.url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
        return { buf, origem: u.origem };
      } catch (e) { erros.push(`${u.origem}: ${e.message}`); }
    }
    throw new Error(`${m.arquivo}: ${erros.join(' · ')}`);
  }

  async garantir(chave, aoProgresso) {
    if (this.tarefas[chave]) return this.tarefas[chave];
    if (this.carregando[chave]) return this.carregando[chave];
    this.carregando[chave] = (async () => {
      const { buf, origem } = await this.obterModelo(chave, aoProgresso);
      const tarefa = await this.#criar(chave, buf);
      this.tarefas[chave] = tarefa;
      this.log('ok', `${MODELOS[chave].arquivo} · ${(buf.length / 1048576).toFixed(1)} MB · sha256 ✓ · ${origem} · ${this.backend[chave]}`);
      return tarefa;
    })();
    try { return await this.carregando[chave]; } finally { delete this.carregando[chave]; }
  }

  async #criar(chave, buf) {
    const { ObjectDetector, FaceLandmarker, PoseLandmarker, ImageClassifier, ImageEmbedder } = this.mp;
    const opcoes = delegate => {
      const baseOptions = { modelAssetBuffer: buf, delegate };
      if (chave === 'objetos') return { baseOptions, runningMode: 'VIDEO', scoreThreshold: LIMIARES.deteccao.scoreMin, maxResults: 25 };
      if (chave === 'rosto') return { baseOptions, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
      // recortes e ladrilhos são imagens soltas, sem continuidade temporal: modo IMAGE
      if (chave === 'classificador') return { baseOptions, runningMode: 'IMAGE', maxResults: 8, scoreThreshold: 0.02 };
      if (chave === 'embedder') return { baseOptions, runningMode: 'IMAGE', l2Normalize: true, quantize: false };
      return { baseOptions, runningMode: 'VIDEO', numPoses: 3, minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5, outputSegmentationMasks: false };
    };
    const Classe = { objetos: ObjectDetector, rosto: FaceLandmarker, classificador: ImageClassifier, embedder: ImageEmbedder }[chave] || PoseLandmarker;
    // CPU quando a GPU é por software, ou por ordem do operador (?cpu=1): alguns
    // drivers de GPU de celular travam ou erram — precisa haver saída sem editar código
    if (this.soCPU) {
      const t = await Classe.createFromOptions(this.fileset, opcoes('CPU'));
      this.backend[chave] = 'CPU';
      return t;
    }
    try {
      const t = await Classe.createFromOptions(this.fileset, opcoes('GPU'));
      this.backend[chave] = 'GPU';
      return t;
    } catch (e) {
      this.log('aviso', `${MODELOS[chave].arquivo}: GPU recusada (${String(e.message || e).slice(0, 80)}) — usando CPU`);
      const t = await Classe.createFromOptions(this.fileset, opcoes('CPU'));
      this.backend[chave] = 'CPU';
      return t;
    }
  }

  #ts(chave, t) {
    const ult = this.ultimoTs[chave] ?? -1;
    const ts = t > ult ? t : ult + 1;
    this.ultimoTs[chave] = ts;
    return ts;
  }

  /** Objetos → [{classe, score, x, y, w, h}] normalizados no quadro. A fonte pode ser o vídeo ou o quadro realçado (canvas). */
  objetos(video, t) {
    const det = this.tarefas.objetos;
    if (!det) return null;
    const vw = video.videoWidth || video.width, vh = video.videoHeight || video.height;
    const r = det.detectForVideo(video, this.#ts('objetos', t));
    const out = [];
    for (const d of r.detections || []) {
      const c = d.categories?.[0], b = d.boundingBox;
      if (!c || !b || !c.categoryName || c.categoryName === '???') continue;
      const x = Math.max(0, b.originX / vw), y = Math.max(0, b.originY / vh);
      const w = Math.min(1 - x, b.width / vw), h = Math.min(1 - y, b.height / vh);
      if (w <= 0 || h <= 0) continue;
      out.push({ classe: c.categoryName, score: c.score, x, y, w, h });
    }
    return out;
  }

  /** Rosto → { pontos, blend } ou null. */
  rosto(video, t) {
    const fl = this.tarefas.rosto;
    if (!fl) return null;
    const r = fl.detectForVideo(video, this.#ts('rosto', t));
    const pontos = r.faceLandmarks?.[0];
    if (!pontos || pontos.length < 468) return null;
    const blend = {};
    for (const c of r.faceBlendshapes?.[0]?.categories || []) blend[c.categoryName] = c.score;
    return { pontos, blend };
  }

  /** Poses → array de 33 pontos por pessoa. */
  poses(video, t) {
    const pl = this.tarefas.pose;
    if (!pl) return null;
    const r = pl.detectForVideo(video, this.#ts('pose', t));
    return r.landmarks || [];
  }

  /** Classes do ImageNet para uma imagem (recorte/ladrilho) → [{nome, score}] em ordem decrescente. */
  classificar(imagem) {
    const c = this.tarefas.classificador;
    if (!c) return null;
    const r = c.classify(imagem);
    return (r.classifications?.[0]?.categories || []).map(k => ({ nome: k.categoryName, score: k.score }));
  }

  /** Vetor de características (L2-normalizado) de uma imagem → Float32Array, ou null. */
  embedding(imagem) {
    const e = this.tarefas.embedder;
    if (!e) return null;
    const v = e.embed(imagem).embeddings?.[0]?.floatEmbedding;
    return v ? Float32Array.from(v) : null;
  }

  fechar() {
    for (const k of Object.keys(this.tarefas)) { try { this.tarefas[k].close(); } catch {} }
    this.tarefas = {};
  }
}

/* ── câmera ── */
export async function listarCameras() {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.filter(x => x.kind === 'videoinput');
  } catch { return []; }
}

export async function abrirCamera({ deviceId = null, facingMode = null, largura = 1280, altura = 720 } = {}) {
  const video = { width: { ideal: largura }, height: { ideal: altura }, frameRate: { ideal: 30, max: 30 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  else if (facingMode) video.facingMode = { ideal: facingMode };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

/** Diagnóstico de pré-voo: o que falta para a câmera funcionar AQUI. */
export function preVoo() {
  const problemas = [];
  if (!window.isSecureContext) problemas.push('A câmera exige conexão segura (HTTPS) ou localhost. No celular, abra pelo endereço HTTPS da plataforma.');
  if (!navigator.mediaDevices?.getUserMedia) problemas.push('Este navegador não expõe a câmera (getUserMedia). Use Chrome, Edge, Safari ou Firefox atualizados.');
  if (typeof WebAssembly !== 'object') problemas.push('WebAssembly indisponível — o runtime de visão não roda neste navegador.');
  return problemas;
}
