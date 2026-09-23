/* ═══════════════════════════════════════════════════════════════════
   ELION-X v3 — Reconhecimento Facial real (face-api.js / TensorFlow)
   · detecta rostos, calcula descritor biométrico (128-d) e EMOÇÃO
   · memoriza a família do operador (localStorage) e reconhece depois
   · 100% no navegador — os rostos NÃO saem do computador do operador
═══════════════════════════════════════════════════════════════════ */
(function () {
  const CDN     = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js';
  const MODELS  = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
  const DB_KEY  = 'elx-faces';
  const THRESH  = 0.52;   // distância máxima p/ considerar "mesma pessoa"
  let fa = null, ready = false, loading = null;

  const EMO = { neutral: 'Neutro', happy: 'Feliz', sad: 'Triste', angry: 'Irritado', fearful: 'Apreensivo', disgusted: 'Contrariado', surprised: 'Surpreso' };

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('falha ao carregar face-api'));
      document.head.appendChild(s);
    });
  }

  async function ensure() {
    if (ready) return true;
    if (loading) return loading;
    loading = (async () => {
      if (!window.faceapi) await loadScript(CDN);
      fa = window.faceapi;
      await fa.nets.tinyFaceDetector.loadFromUri(MODELS);
      await fa.nets.faceLandmark68Net.loadFromUri(MODELS);
      await fa.nets.faceRecognitionNet.loadFromUri(MODELS);
      await fa.nets.faceExpressionNet.loadFromUri(MODELS);
      await loadDB();                 // carrega os rostos do servidor (compartilhado)
      ready = true;
      return true;
    })();
    try { return await loading; } catch (e) { loading = null; throw e; }
  }

  // banco de rostos COMPARTILHADO entre dispositivos (servidor) + espelho local offline
  let faceDB = [], dbLoaded = false;
  async function loadDB() {
    try {
      const r = await fetch('/api/faces').then(x => x.json());
      faceDB = Array.isArray(r.faces) ? r.faces : [];
      try { localStorage.setItem(DB_KEY, JSON.stringify(faceDB)); } catch {}
    } catch {
      try { faceDB = JSON.parse(localStorage.getItem(DB_KEY) || '[]'); } catch { faceDB = []; }
    }
    dbLoaded = true;
    return faceDB;
  }
  async function saveFace(person) {                       // grava no servidor + espelho local
    try { await fetch('/api/faces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(person) }); } catch {}
    await loadDB();
  }

  function euclid(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
  function topExpr(ex) { let k = 'neutral', v = 0; for (const e in ex) if (ex[e] > v) { v = ex[e]; k = e; } return EMO[k] || 'Neutro'; }

  function matchDescriptor(desc) {
    let best = null, bestD = THRESH;
    for (const f of faceDB) {
      // média das distâncias contra todas as amostras da pessoa (mais robusto)
      const samples = f.samples || [f.descriptor];
      let min = Infinity;
      for (const s of samples) { const d = euclid(desc, s); if (d < min) min = d; }
      if (min < bestD) { bestD = min; best = f; }
    }
    return best ? { name: best.name, relation: best.relation || '', distance: +bestD.toFixed(3), confidence: Math.max(0, Math.round((1 - bestD / 0.7) * 100)) } : null;
  }

  async function detect(input, withDesc = true) {
    await ensure();
    const opts = new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });
    let q = fa.detectAllFaces(input, opts).withFaceLandmarks().withFaceExpressions();
    if (withDesc) q = q.withFaceDescriptors();
    return await q;
  }

  /** memoriza o rosto MAIOR/mais próximo do frame, sob um nome+parentesco (sincroniza no servidor) */
  async function enroll(name, relation, input) {
    if (!dbLoaded) await loadDB();
    const dets = await detect(input, true);
    if (!dets.length) return { ok: false, msg: 'nenhum rosto detectado — peça para a pessoa se enquadrar na câmera' };
    const big = dets.slice().sort((a, b) => (b.detection.box.width * b.detection.box.height) - (a.detection.box.width * a.detection.box.height))[0];
    const desc = Array.from(big.descriptor);
    const existing = faceDB.find(f => f.name.toLowerCase() === name.toLowerCase());
    const samples = existing ? (existing.samples || [existing.descriptor]).concat([desc]).slice(-6) : [desc];
    await saveFace({ name, relation: relation || existing?.relation || '', descriptor: desc, samples });
    return { ok: true, name, relation, total: faceDB.length };
  }

  /** reconhece TODAS as faces do frame → [{box(normalizado), name, relation, emotion, known, confidence}] */
  async function recognize(input) {
    if (!dbLoaded) await loadDB();
    const vw = input.videoWidth || input.width || input.naturalWidth || 1;
    const vh = input.videoHeight || input.height || input.naturalHeight || 1;
    const dets = await detect(input, true);
    return dets.map(d => {
      const b = d.detection.box;
      const m = matchDescriptor(d.descriptor);
      return {
        box: { x: b.x / vw, y: b.y / vh, w: b.width / vw, h: b.height / vh },
        name: m?.name || null, relation: m?.relation || null,
        confidence: m?.confidence ?? null, emotion: topExpr(d.expressions),
        known: !!m,
      };
    });
  }

  ELX.face = {
    ensure, enroll, recognize, loadDB,
    list: () => faceDB.map(f => ({ name: f.name, relation: f.relation, samples: (f.samples || [1]).length })),
    forget: async name => { try { await fetch('/api/faces?name=' + encodeURIComponent(name || ''), { method: 'DELETE' }); } catch {} await loadDB(); },
    get ready() { return ready; },
  };
})();
