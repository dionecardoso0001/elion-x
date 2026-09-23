/* ═══════════════════════════════════════════════════════════════════
   ELION-X v3 — Rosto Humanizado (avatar 3D realista, Three.js r128)
   Alternativa visual à esfera neural: um rosto humano que fala com
   lip-sync dirigido pelo MESMO áudio do TTS (ELX.audio.bands()),
   pisca, respira, olha para o operador e muda de humor por estado:
     idle      → sorriso leve, piscadas, olhar calmo
     listening → sobrancelhas erguidas, atenção total
     thinking  → olhar para cima, testa franzida
     speaking  → boca articula com a voz (visemes ARKit/Oculus)
   Avatar: assets/avatar/avatarsdk.glb — homem realista (padrão RPM/ARKit,
   66 morphs) com TRATAMENTO CIBORGUE via shader: o lado esquerdo do rosto
   (x>0 no mundo) vira liga metálica escura com circuitos de energia ciano
   pulsando, costura de energia na linha central e olho-LED no lado robô.
   Troque por outro GLB compatível via clique-direito no botão ROSTO.
═══════════════════════════════════════════════════════════════════ */
(function () {
  const wrap        = document.getElementById('sphereWrap');
  const canvas      = document.getElementById('avatarCanvas');
  const sphereCv    = document.getElementById('sphereCanvas');
  const toggleBtn   = document.getElementById('faceToggle');
  if (!wrap || !canvas || !toggleBtn) return;

  const DEFAULT_URL = 'assets/avatar/avatarsdk.glb';
  const LS_MODE = 'elx-visual';        // 'sphere' | 'face'
  const LS_URL  = 'elx-avatar-url';    // GLB customizado (opcional)

  /* ── estado do módulo (lazy: só cria WebGL quando ativar) ── */
  let inited = false, loading = false, active = false, failed = false;
  let renderer, scene, camera, clock, model;
  const bones  = {};                   // Head, Neck, LeftEye, RightEye, Spine2…
  const morphMeshes = [];              // meshes com morphTargetDictionary
  const cur = Object.create(null);     // valores atuais dos morphs (suavizados)
  const restPose = {};                 // rotação de repouso dos ossos

  /* ═════════ FUNDO CIBER — chuva de código binário + polígonos wireframe ═════════
     Canvas 2D ATRÁS do avatar (só no modo rosto). Zero deps, pausa fora do modo. */
  const bg = { cv: document.getElementById('avatarBg'), ctx: null, raf: 0, on: false, w: 0, h: 0, fs: 14, cols: [], pts: [], last: 0 };
  function bgMakePoly() {
    const sides = 3 + Math.floor(Math.random() * 4);
    return {
      x: Math.random() * bg.w, y: Math.random() * bg.h, r: 24 + Math.random() * 72, sides,
      rot: Math.random() * Math.PI, spin: (Math.random() - 0.5) * 0.5,
      vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
      c: Math.random() < 0.5 ? '0,229,255' : '0,255,157',
    };
  }
  function bgResize() {
    if (!bg.cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    bg.w = wrap.clientWidth; bg.h = wrap.clientHeight;
    if (!bg.w || !bg.h) return;
    bg.cv.width = bg.w * dpr; bg.cv.height = bg.h * dpr;
    bg.cv.style.width = bg.w + 'px'; bg.cv.style.height = bg.h + 'px';
    bg.ctx = bg.cv.getContext('2d');
    bg.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg.fs = Math.max(10, Math.round(bg.w / 62));                 // chuva mais DENSA
    // vinheta ESCURA de alto contraste (cacheada): leve respiro atrás da cabeça,
    // quase preto nas bordas — o efeito holograma fica SÓ no avatar, não no fundo
    bg.vg = bg.ctx.createRadialGradient(bg.w * 0.72, bg.h * 0.38, Math.min(bg.w, bg.h) * 0.12, bg.w * 0.5, bg.h * 0.5, Math.max(bg.w, bg.h) * 0.78);
    bg.vg.addColorStop(0, '#04121f'); bg.vg.addColorStop(0.55, '#020a13'); bg.vg.addColorStop(1, '#010407');
    // sprites NEON dos dígitos: glow verde incandescente PRÉ-RENDERIZADO (bloom barato —
    // desenhar shadowBlur em ~1500 fillText/frame mataria o FPS; drawImage não)
    {
      const s = Math.ceil(bg.fs * 3); bg.spr = { s };
      for (const ch of ['0', '1']) {
        for (const [tier, fill, glow, blur, passes] of [
          ['head', 'rgba(235,255,248,1)', 'rgba(140,255,200,1)', bg.fs * 0.95, 3],  // cabeça branca-verde estourada
          ['tail', 'rgba(120,255,190,1)', 'rgba(0,255,140,1)',   bg.fs * 0.80, 2],  // cauda verde neon acesa
        ]) {
          const cv = document.createElement('canvas'); cv.width = cv.height = s;
          const c2 = cv.getContext('2d');
          c2.font = `bold ${bg.fs}px 'Share Tech Mono', monospace`;
          c2.textAlign = 'center'; c2.textBaseline = 'middle';
          c2.shadowColor = glow; c2.shadowBlur = blur; c2.fillStyle = fill;
          for (let p = 0; p < passes; p++) c2.fillText(ch, s / 2, s / 2);  // passes = bloom acumulado
          bg.spr[tier + ch] = cv;
        }
      }
    }
    const n = Math.max(1, Math.floor(bg.w / (bg.fs * 0.82)));    // + colunas
    bg.cols = Array.from({ length: n }, (_, i) => {
      const len = 8 + Math.floor(Math.random() * 20);
      return { x: (i + 0.5) * bg.w / n, headY: Math.random() * bg.h, acc: 0,
        speed: bg.fs * (2.6 + Math.random() * 4.2), len,
        chars: Array.from({ length: len }, () => Math.random() < 0.5 ? '0' : '1') };
    });
    // REDE: centenas de pontos que se conectam por linhas + nós brilhantes
    const P = Math.round(bg.w * bg.h / 12000);
    bg.pts = Array.from({ length: Math.max(50, Math.min(150, P)) }, () => ({
      x: Math.random() * bg.w, y: Math.random() * bg.h,
      vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16,
    }));
  }
  function bgFrame(now) {
    if (!bg.on) return;
    bg.raf = requestAnimationFrame(bgFrame);
    const ctx = bg.ctx; if (!ctx) return;
    const dt = Math.min((now - bg.last) / 1000 || 0, 0.05); bg.last = now;
    // ── fundo ESCURO de alto contraste (vinheta) — sem estática: holograma só no avatar ──
    if (bg.vg) { ctx.fillStyle = bg.vg; ctx.fillRect(0, 0, bg.w, bg.h); }
    else ctx.clearRect(0, 0, bg.w, bg.h);
    // ── REDE de polígonos: centenas de pontos AMARRADOS por linhas + nós brilhantes ──
    const pts = bg.pts, LINK = Math.min(bg.w, bg.h) * 0.17, LINK2 = LINK * LINK;
    for (const p of pts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0) { p.x = 0; p.vx *= -1; } else if (p.x > bg.w) { p.x = bg.w; p.vx *= -1; }
      if (p.y < 0) { p.y = 0; p.vy *= -1; } else if (p.y > bg.h) { p.y = bg.h; p.vy *= -1; }
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < LINK2) {
          const al = (1 - Math.sqrt(d2) / LINK) * 0.55;
          ctx.strokeStyle = `rgba(0,229,255,${al})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    ctx.shadowColor = 'rgba(0,255,200,0.9)'; ctx.shadowBlur = 8; ctx.fillStyle = 'rgba(150,255,225,0.95)';
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.shadowBlur = 0;
    // chuva binária (0/1) NEON: sprites com glow verde incandescente — cabeça
    // branca-verde estourada, cauda verde acesa desvanecendo ao subir
    const sh = bg.spr ? bg.spr.s / 2 : 0;
    for (const c of bg.cols) {
      c.headY += c.speed * dt; c.acc += c.speed * dt;
      while (c.acc >= bg.fs) { c.acc -= bg.fs; c.chars.unshift(Math.random() < 0.5 ? '0' : '1'); if (c.chars.length > c.len) c.chars.pop(); }
      if (Math.random() < 0.06) c.chars[1 + (Math.random() * (c.len - 1) | 0)] = Math.random() < 0.5 ? '0' : '1';
      if (c.headY - c.len * bg.fs > bg.h) { c.headY = -Math.random() * bg.h * 0.6; c.speed = bg.fs * (2.4 + Math.random() * 4.0); }
      if (!bg.spr) continue;
      for (let k = 0; k < c.chars.length; k++) {
        const yy = c.headY - k * bg.fs;
        if (yy < -bg.fs || yy > bg.h + bg.fs) continue;
        ctx.globalAlpha = k === 0 ? 1 : Math.max(0, 0.92 * (1 - k / c.len));
        ctx.drawImage(bg.spr[(k === 0 ? 'head' : 'tail') + c.chars[k]], c.x - sh, yy - sh);
      }
    }
    ctx.globalAlpha = 1;
  }
  function bgStart() {
    if (!bg.cv) return;
    bg.on = true; bg.cv.style.display = 'block';
    bgResize(); bg.last = performance.now();
    cancelAnimationFrame(bg.raf); bg.raf = requestAnimationFrame(bgFrame);
  }
  function bgStop() {
    bg.on = false; cancelAnimationFrame(bg.raf);
    if (bg.cv) { bg.cv.style.display = 'none'; if (bg.ctx) bg.ctx.clearRect(0, 0, bg.w, bg.h); }
  }

  /* ═════════ OLHO CIBERNÉTICO — rosto 100% HUMANO; apenas UM olho vira
     robô neon (azul ↔ púrpura reluzente e pulsante). Nada mais é alterado. */
  const CYB = { mats: [] };
  let neonEyeDone = false, neonEyeMesh = null, neonEyeBone = 'LeftEye';
  function cyborgize(mesh) {
    if (neonEyeDone) return;                            // garante APENAS um olho
    const name = (mesh.name || '').toLowerCase();
    if (!/eyeball/.test(name)) return;                 // só o globo ocular (não cílios/AO/pele)
    if (!mesh.material) return;
    neonEyeDone = true; neonEyeMesh = mesh;             // projetado na tela p/ o HUD holográfico
    neonEyeBone = /right/.test(name) ? 'RightEye' : 'LeftEye';   // osso do olho (acompanha a cabeça)
    const mat = mesh.material.clone();
    mesh.material = mat;
    mat.userData.uTime = { value: 0 };
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = mat.userData.uTime;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <dithering_fragment>',
          '#include <dithering_fragment>\n{\n' +
          '  vec3 iron = vec3(0.62, 0.86, 1.0);\n' +                                  // branco-ciano Homem de Ferro
          '  gl_FragColor.rgb = mix(gl_FragColor.rgb, iron, 0.90);\n' +
          '  gl_FragColor.rgb += vec3(0.55, 0.80, 1.0) * (0.85 + 0.35 * sin(uTime * 3.0));\n' +  // brilho forte pulsante
          '}');
      mat.needsUpdate = true;
    };
    mat.needsUpdate = true;
    CYB.mats.push(mat);
  }

  /* ═════════ ROSTO-HOLOGRAMA DE PARTÍCULAS (referência do operador) ═════════
     A pele inteira vira um holograma AZUL feito de "partículas" (grão animado):
     luminância → gradiente navy→azul→branco-ciano; grão em células de tela que
     cintila; bordas e pescoço se DISSOLVEM em partículas (discard por ruído),
     como se o rosto emergisse da estática do fundo. A boca ACENDE enquanto
     fala (uSpeak), reforçando o lip-sync. Toda a animação (visemes, piscadas,
     ossos, olho robótico) permanece — só o VISUAL muda. */
  const HOLO = { mats: [], spk: 0, eye: new THREE.Vector3(0, -99, 0), eyeR: { value: 0.040 } }; // raio calibrado visualmente
  function hologrize(mesh) {
    if (!mesh.material || mesh === neonEyeMesh) return;      // o olho neon tem shader próprio
    const apply = src => {
      const mat = src.clone();
      mat.userData.uTime  = { value: 0 };
      mat.userData.uSpeak = { value: 0 };
      mat.userData.uFade  = { value: new THREE.Vector2(-99, -98) }; // definido após medir a cabeça
      mat.userData.uMouth = { value: 0 };
      mat.userData.uEye   = { value: HOLO.eye }; // posição-mundo do olho robótico (Vector3 compartilhado)
      mat.userData.uEyeR  = HOLO.eyeR;           // raio da placa ocular (uniform compartilhado p/ calibrar ao vivo)
      mat.onBeforeCompile = shader => {
        shader.uniforms.uTime  = mat.userData.uTime;
        shader.uniforms.uSpeak = mat.userData.uSpeak;
        shader.uniforms.uFade  = mat.userData.uFade;
        shader.uniforms.uMouth = mat.userData.uMouth;
        shader.uniforms.uEye   = mat.userData.uEye;
        shader.uniforms.uEyeR  = mat.userData.uEyeR;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHoloPos;')
          .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvHoloPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'); // espaço-MUNDO (bate com a altura da cabeça)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>',
            '#include <common>\nuniform float uTime;\nuniform float uSpeak;\nuniform float uMouth;\nuniform vec2 uFade;\nuniform vec3 uEye;\nuniform float uEyeR;\nvarying vec3 vHoloPos;\n' +
            'float hHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
          .replace('#include <dithering_fragment>',
            `#include <dithering_fragment>
{
  float lum = pow(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)), 1.6); // comprime médios → azul profundo
  vec3 deep = vec3(0.005, 0.035, 0.11);
  vec3 azul = vec3(0.05, 0.27, 0.62);
  vec3 hot  = vec3(0.62, 0.88, 1.0);
  vec3 holo = mix(deep, azul, smoothstep(0.02, 0.48, lum));
  holo = mix(holo, hot, smoothstep(0.55, 0.97, lum));
  vec2 cell = floor(gl_FragCoord.xy / 1.7);                       // "partícula" = célula de tela
  float n  = hHash(cell + floor(uTime * 22.0) * 17.3);            // grão que fervilha
  float n2 = hHash(cell * 0.37 + floor(uTime * 7.0) * 3.1);
  float fade = smoothstep(uFade.x, uFade.y, vHoloPos.y);          // pescoço/bordas dissolvem
  if (n > fade * (0.93 + 0.07 * n2)) discard;                     // vira partículas esparsas
  float mouth = exp(-pow((vHoloPos.y - uMouth) * 15.0, 2.0)) * uSpeak; // boca acesa na fala
  // ── OLHO ROBÓTICO EMBUTIDO NA PELE (não é overlay: é a própria superfície) ──
  vec3 pe = vHoloPos - uEye;
  float rr = length(pe) / uEyeR;                                  // 0 = centro do globo, 1 = borda da placa
  if (rr < 1.12) {                                                // placa tech escura SOB a pele
    float plate = smoothstep(1.08, 0.45, rr);
    holo = mix(holo, vec3(0.015, 0.09, 0.20) + holo * 0.30, plate * 0.9);
  }
  holo *= 0.60 + 0.55 * n + 0.28 * n2 + mouth * 1.1;
  holo += hot * step(0.985, n) * (0.75 + mouth);                  // partículas que faíscam
  if (rr < 1.12) {                                                // anéis/circuitos gravados na superfície
    float ang = atan(pe.y, pe.x);
    float pulse = 0.75 + 0.25 * sin(uTime * 2.6);
    float ring1 = smoothstep(0.050, 0.014, abs(rr - 0.52));
    float seg   = step(0.30, fract(ang * 3.8197 + uTime * 0.22));         // segmentos girando
    float ring2 = smoothstep(0.045, 0.012, abs(rr - 0.74)) * (0.35 + 0.65 * seg);
    float ring3 = smoothstep(0.040, 0.010, abs(rr - 0.98)) * 0.8;
    float spoke = step(0.90, fract(ang * 2.8648 + floor(uTime * 3.0) * 0.13))
                * smoothstep(1.0, 0.55, rr) * step(0.50, rr) * 0.9;       // trilhas radiais cintilando
    vec3 eyeCol = vec3(0.45, 0.85, 1.0);
    holo += eyeCol * (ring1 + ring2 + ring3 + spoke) * pulse * (0.7 + 0.5 * n) * 1.35;
    holo += eyeCol * exp(-rr * 3.2) * 0.55 * pulse;                       // halo junto ao globo
  }
  gl_FragColor.rgb = holo;
}`);
        mat.needsUpdate = true;
      };
      mat.needsUpdate = true;
      HOLO.mats.push(mat);
      return mat;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
  }

  /* ═════════ HUD HOLOGRÁFICO DO OLHO — UI sci-fi projetada SOBRE o olho neon:
     anéis giratórios, varredura radar, reticula e HOLOGRAMAS flutuantes. */
  const fx = { cv: document.getElementById('avatarFx'), ctx: null, on: false, w: 0, h: 0, holos: [], spawn: 0, bits: [], bitSpawn: 0 };
  const _c = new THREE.Vector3(), _e = new THREE.Vector3(), _right = new THREE.Vector3(), _scl = new THREE.Vector3();
  function fxResize() {
    if (!fx.cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.w = wrap.clientWidth; fx.h = wrap.clientHeight;
    if (!fx.w || !fx.h) return;
    fx.cv.width = fx.w * dpr; fx.cv.height = fx.h * dpr;
    fx.cv.style.width = fx.w + 'px'; fx.cv.style.height = fx.h + 'px';
    fx.ctx = fx.cv.getContext('2d');
    fx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function fxShow() { if (!fx.cv) return; fx.on = true; fx.cv.style.display = 'block'; fx.holos.length = 0; fx.bits.length = 0; fxResize(); }
  function fxHide() { fx.on = false; if (fx.cv) { fx.cv.style.display = 'none'; if (fx.ctx) fx.ctx.clearRect(0, 0, fx.w, fx.h); } }
  function neonColor(t, a) {
    return a == null ? 'rgb(140,220,255)' : `rgba(140,220,255,${a})`;   // branco-ciano Homem de Ferro
  }
  function eyeScreen() {
    if (!neonEyeMesh || !camera) return null;
    const g = neonEyeMesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    neonEyeMesh.getWorldScale(_scl);
    const worldR = g.boundingSphere.radius * Math.max(_scl.x, _scl.y, _scl.z);
    // POSIÇÃO: usa o OSSO do olho, que se move com a rotação da cabeça (o globo é
    // SkinnedMesh — matrixWorld fica na raiz e NÃO acompanha; era esse o desalinho).
    const bone = bones[neonEyeBone];
    if (bone) bone.getWorldPosition(_c);
    else _c.copy(g.boundingSphere.center).applyMatrix4(neonEyeMesh.matrixWorld);
    _right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(worldR);
    _e.copy(_c).add(_right);
    _c.project(camera); _e.project(camera);
    if (_c.z > 1) return null;
    const x = (_c.x * 0.5 + 0.5) * fx.w, y = (-_c.y * 0.5 + 0.5) * fx.h;
    const r = Math.hypot((_e.x - _c.x) * 0.5 * fx.w, (_e.y - _c.y) * 0.5 * fx.h);
    return { x, y, r: Math.max(10, r) };
  }
  function fxSpawnBit(x, y, r) {
    const ang = Math.random() * Math.PI * 2, sp = 28 + Math.random() * 66;
    fx.bits.push({ x: x + Math.cos(ang) * r * 0.4, y: y + Math.sin(ang) * r * 0.4,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 8, life: 0, max: 1.1 + Math.random() * 1.3,
      ch: Math.random() < 0.5 ? '0' : '1', size: 9 + Math.random() * 7 });
    if (fx.bits.length > 70) fx.bits.shift();
  }
  function fxSpawnHolo(x, y) {
    const kinds = ['panel', 'glyph', 'bars', 'ring'];
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.7;   // sobe/espalha a partir do olho
    const sp = 20 + Math.random() * 34;
    fx.holos.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0,
      max: 1.5 + Math.random() * 1.6, kind: kinds[Math.random() * kinds.length | 0],
      rot: (Math.random() - 0.5) * 0.5, size: 12 + Math.random() * 20,
      hex: '0x' + (Math.random() * 65536 | 0).toString(16).toUpperCase().padStart(4, '0') });
    if (fx.holos.length > 38) fx.holos.shift();
  }
  function fxDraw(t, dt) {
    if (!fx.on || !fx.ctx) return;
    const ctx = fx.ctx;
    ctx.clearRect(0, 0, fx.w, fx.h);
    const e = eyeScreen(); if (!e) return;
    const R = Math.max(13, Math.min(38, e.r * 1.12));       // referência p/ os emissores de partículas
    // (o olho robótico agora é EMBUTIDO na pele, via shader — nada é desenhado por cima do globo)
    // ── partículas de números binários saindo do olho ──
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fx.bitSpawn += dt;
    while (fx.bitSpawn > 0.05) { fx.bitSpawn -= 0.05; fxSpawnBit(e.x, e.y, R); }
    for (let k = fx.bits.length - 1; k >= 0; k--) {
      const b = fx.bits[k];
      b.life += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 6 * dt;
      const bf = b.life / b.max;
      if (bf >= 1) { fx.bits.splice(k, 1); continue; }
      ctx.globalAlpha = Math.max(0, 1 - bf) * 0.9;
      ctx.fillStyle = 'rgb(150,235,255)'; ctx.shadowColor = 'rgba(120,220,255,0.9)'; ctx.shadowBlur = 6;
      ctx.font = `${b.size | 0}px 'Share Tech Mono',monospace`; ctx.fillText(b.ch, b.x, b.y);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    // ── hologramas holográficos flutuantes (mais brilhantes) ──
    fx.spawn += dt;
    if (fx.spawn > 0.26) { fx.spawn = 0; fxSpawnHolo(e.x + (Math.random() - 0.5) * R * 1.2, e.y - R * 0.5); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const flick = 0.82 + 0.18 * Math.sin(t * 40);           // cintilância holográfica
    for (let k = fx.holos.length - 1; k >= 0; k--) {
      const h = fx.holos[k];
      h.life += dt; h.x += h.vx * dt; h.y += h.vy * dt; h.vy += 3 * dt;
      const f = h.life / h.max;
      if (f >= 1) { fx.holos.splice(k, 1); continue; }
      let a = 1; if (f < 0.15) a = f / 0.15; else if (f > 0.55) a = (1 - f) / 0.45;
      ctx.save(); ctx.globalAlpha = Math.max(0, a) * flick; ctx.translate(h.x, h.y); ctx.rotate(h.rot);
      ctx.strokeStyle = 'rgb(160,232,255)'; ctx.fillStyle = 'rgb(200,242,255)'; ctx.lineWidth = 1.2; ctx.shadowColor = 'rgba(150,230,255,0.95)'; ctx.shadowBlur = 8;
      if (h.kind === 'panel') {
        const w = h.size * 1.9, hh = h.size;
        ctx.strokeRect(-w / 2, -hh / 2, w, hh);
        ctx.beginPath(); ctx.moveTo(-w / 2, -hh / 2 + 4); ctx.lineTo(w / 2, -hh / 2 + 4); ctx.stroke();
        ctx.save(); ctx.globalAlpha = Math.max(0, a) * 0.16; ctx.shadowBlur = 0;   // scanlines holográficas
        for (let s = -hh / 2 + 6; s < hh / 2; s += 3) { ctx.beginPath(); ctx.moveTo(-w / 2, s); ctx.lineTo(w / 2, s); ctx.stroke(); }
        ctx.restore();
        ctx.font = `${Math.round(h.size * 0.5)}px 'Share Tech Mono',monospace`; ctx.fillText(h.hex, 0, 3);
      } else if (h.kind === 'glyph') {
        const s = 3 + (h.size / 7 | 0); ctx.beginPath();
        for (let i = 0; i <= s; i++) { const ag = h.rot + i / s * Math.PI * 2; const px = Math.cos(ag) * h.size * 0.5, py = Math.sin(ag) * h.size * 0.5; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.stroke();
      } else if (h.kind === 'bars') {
        for (let i = 0; i < 5; i++) { const bh = 3 + ((h.life * 40 + i * 9) % h.size); ctx.fillRect(-h.size * 0.5 + i * 4.5, h.size * 0.5 - bh, 3, bh); }
      } else {
        ctx.beginPath(); ctx.arc(0, 0, h.size * 0.3 + f * h.size * 0.7, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function setMorphNow(name, v) {
    for (const m of morphMeshes) {
      const i = m.morphTargetDictionary[name];
      if (i !== undefined) m.morphTargetInfluences[i] = v;
    }
  }
  /* suavização assimétrica: ataque rápido (boca abre já), soltura macia */
  function drive(name, target, attack = 0.5, release = 0.22) {
    const c = cur[name] || 0;
    const k = target > c ? attack : release;
    const v = c + (target - c) * k;
    cur[name] = v;
    setMorphNow(name, v);
  }

  /* ═════════ INICIALIZAÇÃO ═════════ */
  function init() {
    if (inited || loading) return;
    loading = true;
    toggleBtn.textContent = '⟳ CARREGANDO…';

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(26, 1, 0.05, 50);
    clock  = new THREE.Clock();

    /* iluminação: chave neutra (rosto realista) + rim ciano/verde (mundo ELION) */
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x0a1418, 0.85));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.15);
    key.position.set(0.5, 1.8, 1.6);
    scene.add(key);
    const rimC = new THREE.DirectionalLight(0x00e5ff, 0.85);
    rimC.position.set(-1.6, 1.2, -1.0);
    scene.add(rimC);
    const rimG = new THREE.DirectionalLight(0x00ff9d, 0.5);
    rimG.position.set(1.7, 0.6, -1.2);
    scene.add(rimG);

    const url = localStorage.getItem(LS_URL) || DEFAULT_URL;
    new THREE.GLTFLoader().load(url, gltf => {
      model = gltf.scene;
      scene.add(model);

      model.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.frustumCulled = false;
          if (o.morphTargetDictionary) morphMeshes.push(o);
          cyborgize(o);                                   // olho robótico neon (mantido)
          hologrize(o);                                   // pele → holograma de partículas azuis
        }
        if (o.isBone) bones[o.name] = o;
      });
      for (const n of ['Head', 'Neck', 'LeftEye', 'RightEye', 'Spine2', 'Spine1']) {
        if (bones[n]) restPose[n] = bones[n].rotation.clone();
      }
      /* braços colados ao corpo (o GLB vem em T-pose) */
      if (bones.LeftArm)  bones.LeftArm.rotation.z  = 1.25;
      if (bones.RightArm) bones.RightArm.rotation.z = -1.25;

      /* enquadramento: busto — câmera na altura dos olhos */
      const hp = new THREE.Vector3();
      (bones.Head || model).getWorldPosition(hp);
      camera.position.set(hp.x, hp.y + 0.04, hp.z + 0.72);
      camera.lookAt(hp.x, hp.y + 0.02, hp.z);
      camTarget.set(hp.x, hp.y + 0.02, hp.z);

      /* calibra o holograma pela altura da cabeça: sólido no rosto,
         dissolvendo em partículas do queixo para baixo; boca ≈ 4,5cm abaixo */
      HOLO.set = (lo, hi, mouth) => {
        for (const m of HOLO.mats) {
          m.userData.uFade.value.set(lo, hi);
          if (mouth != null) m.userData.uMouth.value = mouth;
        }
      };
      HOLO.hpy = hp.y;
      HOLO.set(hp.y - 0.115, hp.y - 0.045, hp.y - 0.02); // calibrado visualmente: queixo sólido, pescoço dissolve
      ELX._holo = HOLO; // calibração ao vivo pelo console (depuração)

      inited = true; loading = false;
      updateToggleUI();
      animate();
    }, undefined, err => {
      console.error('[avatar] falha ao carregar GLB', err);
      loading = false; failed = true;
      (window.ELX && ELX.toast ? ELX.toast : alert)('Falha ao carregar o rosto — voltando para a esfera.');
      applyMode('sphere');
    });

    new ResizeObserver(resize).observe(wrap);
    resize();
  }

  const camTarget = new THREE.Vector3();
  function resize() {
    if (bg.on) bgResize();
    if (fx.on) fxResize();
    if (!renderer) return;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ── mouse: o rosto acompanha o operador com o olhar ── */
  let mx = 0, my = 0, smx = 0, smy = 0;
  window.addEventListener('mousemove', e => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  /* ── piscadas ── */
  let blinkT = 2.2, blinkPhase = 0; // 0 = aberto; >0 = animando
  function updateBlink(dt) {
    if (blinkPhase > 0) {
      blinkPhase -= dt;
      const f = Math.max(0, blinkPhase / 0.16);          // 1 → 0
      const v = Math.sin(Math.min(1, 1 - f) * Math.PI);  // sobe e desce
      setMorphNow('eyeBlinkLeft', v); setMorphNow('eyeBlinkRight', v);
      return;
    }
    blinkT -= dt;
    if (blinkT <= 0) {
      blinkPhase = 0.16;
      blinkT = 1.8 + Math.random() * 4.2;
      if (Math.random() < 0.12) blinkT = 0.35;           // piscada dupla ocasional
    } else {
      setMorphNow('eyeBlinkLeft', 0); setMorphNow('eyeBlinkRight', 0);
    }
  }

  /* ── sacadas oculares (micro-movimentos do olhar) ── */
  let sacT = 1.5, sacX = 0, sacY = 0;
  function updateEyes(dt, st) {
    sacT -= dt;
    if (sacT <= 0) {
      sacT = 0.7 + Math.random() * 2.4;
      sacX = (Math.random() - 0.5) * 0.10;
      sacY = (Math.random() - 0.5) * 0.06;
    }
    /* pensando → olhar sobe e deriva; senão acompanha o mouse + sacadas */
    const lookX = st === 'thinking' ? 0.14 + sacX : smx * 0.22 + sacX;
    const lookY = st === 'thinking' ? -0.22 : -smy * 0.14 + sacY;
    for (const n of ['LeftEye', 'RightEye']) {
      const b = bones[n]; if (!b || !restPose[n]) continue;
      b.rotation.x = restPose[n].x + lookY;
      b.rotation.y = restPose[n].y + lookX;
    }
  }

  /* ═════════ LIP-SYNC por FORMANTES ═════════
     A versão antiga movia a boca com senóides do relógio — parecia falar, mas
     não acompanhava o som. Agora cada quadro classifica o fonema pelo espectro:
     ELX.audio.voice() devolve dois eixos contínuos (abertura × anterioridade)
     que posicionam a boca no ESPAÇO VOCÁLICO, mais sibilância/fricativa/
     transiente para as consoantes.

     Cada vogal é um ponto nesse plano; a mistura é feita por peso gaussiano da
     distância — é isso que produz a CO-ARTICULAÇÃO (a boca passa por formas
     intermediárias ao ir de /i/ para /a/, como um rosto real). */
  /* Pontos-alvo CALIBRADOS: não são valores teóricos, e sim a leitura real do
     analisador para cada vogal do português (medida com espectros de formantes
     conhecidos — /a/ 700·1200, /ɛ/ 550·1850, /e/ 420·2100, /i/ 300·2350,
     /ɔ/ 570·950, /o/ 450·850, /u/ 330·750 Hz). Calibrar contra a medição, e não
     contra a teoria, é o que faz o viseme certo vencer em todas as vogais. */
  const VOWELS = [                       //         abertura, anterioridade
    { m: 'viseme_aa', o: 0.84, f: 0.30, jaw: 1.00 },  // /a/  — bem aberta
    { m: 'viseme_E',  o: 0.42, f: 0.75, jaw: 0.55 },  // /e/ /ɛ/ — entreaberta, esticada
    { m: 'viseme_I',  o: 0.00, f: 0.97, jaw: 0.20 },  // /i/  — fechada, sorriso
    { m: 'viseme_O',  o: 0.48, f: 0.12, jaw: 0.60 },  // /o/ /ɔ/ — arredondada
    { m: 'viseme_U',  o: 0.12, f: 0.04, jaw: 0.22 },  // /u/  — bico, projetada
  ];
  const CONSO = ['viseme_PP', 'viseme_FF', 'viseme_SS', 'viseme_CH', 'viseme_TH', 'viseme_kk', 'viseme_nn', 'viseme_DD', 'viseme_RR', 'viseme_sil'];
  const MOUTH_EXTRA = ['jawOpen', 'mouthFunnel', 'mouthPucker', 'mouthStretchLeft', 'mouthStretchRight',
    'mouthPressLeft', 'mouthPressRight', 'mouthShrugLower', 'mouthLowerDownLeft', 'mouthLowerDownRight',
    'mouthUpperUpLeft', 'mouthUpperUpRight'];
  /* Morphs PROIBIDOS no lip-sync: todos puxam os lábios para DENTRO da boca.
     Acionados junto com jawOpen davam o efeito "banguela" — o maxilar abria e o
     lábio inferior sumia para dentro. Ficam travados em zero. */
  const LIP_ROLL = ['mouthClose', 'mouthRollLower', 'mouthRollUpper'];
  const ALL_MOUTH = [...VOWELS.map(v => v.m), ...CONSO, ...MOUTH_EXTRA, ...LIP_ROLL];
  const SIGMA2 = 2 * 0.26 * 0.26;        // largura do blend entre vogais vizinhas

  let hasMorph = null;                   // quais morphs o GLB realmente tem
  function morphExists(name) {
    if (!hasMorph) {
      hasMorph = new Set();
      for (const m of morphMeshes) for (const k in m.morphTargetDictionary) hasMorph.add(k);
    }
    return hasMorph.has(name);
  }
  /** só aciona o morph se ele existir no modelo (GLBs variam de padrão) */
  function driveIf(name, v, atk, rel) { if (morphExists(name)) drive(name, v, atk, rel); }

  const lip = { open: 0.4, front: 0.5, lvl: 0 };

  function updateMouth(dt, st, t) {
    const speakingNow = st === 'speaking' || st === 'live';
    const a = ELX.audio.voice ? ELX.audio.voice() : { level: 0 };
    let lvl = speakingNow ? a.level : 0;
    if (lvl < 0.045) lvl = 0;                       // portão de ruído

    if (!lvl) {                                     // silêncio → boca repousa
      for (const n of ALL_MOUTH) driveIf(n, 0, 0.5, 0.22);
      driveIf('viseme_sil', 0.15, 0.2, 0.2);
      lip.lvl += (0 - lip.lvl) * 0.3;
      return;
    }

    /* Suavização dos EIXOS (não das formas): o alvo articulatório muda rápido
       na sílaba, mas a musculatura tem inércia — sem isto a boca "treme". */
    const kOpen = a.open > lip.open ? 0.55 : 0.34;  // abre rápido, fecha um pouco mais devagar
    lip.open  += (a.open  - lip.open)  * kOpen;
    lip.front += (a.front - lip.front) * 0.38;
    lip.lvl   += (lvl - lip.lvl) * (lvl > lip.lvl ? 0.6 : 0.3);

    /* consoantes tiram a boca do modo vogal */
    const sib = Math.min(1, a.sib * (1 - a.voiced * 0.5));   // /s/ /ʃ/ — dentes, boca quase fechada
    const fric = Math.min(1, a.fric);                        // /f/ /v/ — lábio no dente
    const stop = a.burst;                                    // /p/ /b/ — lábios se tocam e soltam
    const consonant = Math.min(1, sib * 0.9 + fric * 0.7 + stop * 0.85);
    const vowelGain = lip.lvl * (1 - consonant * 0.65);

    /* mistura vocálica por proximidade no plano (co-articulação) */
    let sum = 0; const w = new Array(VOWELS.length);
    for (let i = 0; i < VOWELS.length; i++) {
      const v = VOWELS[i];
      const d2 = (lip.open - v.o) ** 2 + (lip.front - v.f) ** 2;
      w[i] = Math.exp(-d2 / SIGMA2);
      sum += w[i];
    }
    let jawTarget = 0;
    for (let i = 0; i < VOWELS.length; i++) {
      const v = VOWELS[i], peso = w[i] / sum;
      driveIf(v.m, Math.min(0.95, peso * vowelGain * 1.35), 0.62, 0.3);
      jawTarget += peso * v.jaw;
    }

    /* MANDÍBULA: seque a abertura real da vogal e a energia — é o que dá o
       "peso" da fala. Consoantes fecham o maxilar. */
    driveIf('jawOpen', Math.min(0.62, jawTarget * lip.lvl * 0.78 * (1 - consonant * 0.7)), 0.66, 0.32);

    /* arredondamento: /o/ /u/ projetam os lábios */
    const round = Math.max(0, 1 - lip.front * 1.6) * lip.lvl;
    driveIf('mouthFunnel', Math.min(0.45, round * 0.6), 0.5, 0.26);
    driveIf('mouthPucker', Math.min(0.40, round * 0.5 * (1 - lip.open)), 0.5, 0.26);

    /* estiramento: /i/ /e/ puxam os cantos da boca */
    const spread = Math.max(0, lip.front - 0.6) * 2.2 * lip.lvl;
    driveIf('mouthStretchLeft',  Math.min(0.35, spread * 0.5), 0.5, 0.26);
    driveIf('mouthStretchRight', Math.min(0.35, spread * 0.5), 0.5, 0.26);

    /* LÁBIO INFERIOR — o que impedia o rosto de parecer banguela.
       Com jawOpen sozinho o maxilar desce mas o lábio fica "colado" na gengiva,
       dando a impressão de estar sendo engolido. Estes dois morphs acompanham a
       abertura: o inferior desce junto com o queixo e é empurrado para FORA. */
    const jawNow = cur['jawOpen'] || 0;
    driveIf('mouthLowerDownLeft',  Math.min(0.42, jawNow * 0.62), 0.6, 0.3);
    driveIf('mouthLowerDownRight', Math.min(0.42, jawNow * 0.62), 0.6, 0.3);
    driveIf('mouthShrugLower',     Math.min(0.30, jawNow * 0.34 + round * 0.18), 0.5, 0.28);
    // lábio superior sobe de leve nas vogais abertas — evita boca "de peixe"
    driveIf('mouthUpperUpLeft',  Math.min(0.22, lip.open * lip.lvl * 0.26), 0.5, 0.28);
    driveIf('mouthUpperUpRight', Math.min(0.22, lip.open * lip.lvl * 0.26), 0.5, 0.28);

    /* consoantes — PP contido: no padrão RPM ele já comprime bastante os lábios,
       e em excesso lê como boca "sumindo" em vez de fechar para /p/ /b/ */
    driveIf('viseme_SS', Math.min(0.7, sib * 0.8), 0.8, 0.4);
    driveIf('viseme_CH', Math.min(0.5, sib * 0.4 * (1 - lip.front)), 0.7, 0.4);
    driveIf('viseme_FF', Math.min(0.55, fric * 0.65), 0.7, 0.4);
    driveIf('viseme_PP', Math.min(0.34, stop * 0.38), 0.85, 0.5);
    driveIf('viseme_sil', 0, 0.4, 0.3);

    /* trava de segurança: nada pode enrolar os lábios para dentro */
    for (const n of LIP_ROLL) driveIf(n, 0, 0.9, 0.9);
  }

  /* ── humor por estado ── */
  function updateMood(st, lvl) {
    const speakingNow = st === 'speaking' || st === 'live';
    let smile = 0.14, browUp = 0.06, browDown = 0, eyeWide = 0;
    if (st === 'listening') { smile = 0.22; browUp = 0.38; eyeWide = 0.18; }
    else if (st === 'thinking') { smile = 0.05; browUp = 0; browDown = 0.28; }
    else if (speakingNow) { smile = 0.10; browUp = 0.10 + lvl * 0.30; }
    drive('mouthSmileLeft',  smile, 0.06, 0.06);
    drive('mouthSmileRight', smile, 0.06, 0.06);
    drive('browInnerUp',     browUp, 0.10, 0.08);
    drive('browDownLeft',    browDown, 0.08, 0.08);
    drive('browDownRight',   browDown, 0.08, 0.08);
    drive('eyeWideLeft',     eyeWide, 0.10, 0.08);
    drive('eyeWideRight',    eyeWide, 0.10, 0.08);
  }

  /* ── cabeça e respiração ── */
  function updateHead(dt, st, t, lvl) {
    smx += (mx - smx) * 0.04; smy += (my - smy) * 0.04;
    const head = bones.Head, neck = bones.Neck;
    if (head && restPose.Head) {
      let rx = restPose.Head.x + smy * 0.10 + Math.sin(t * 0.42) * 0.018;
      let ry = restPose.Head.y + smx * 0.16 + Math.sin(t * 0.31) * 0.02;
      let rz = restPose.Head.z;
      if (st === 'listening') rz += 0.05;                     // inclina, atento
      if (st === 'thinking')  { rx -= 0.06; ry += 0.05; }     // olha p/ cima
      if (st === 'speaking' || st === 'live') rx += Math.sin(t * 6.4) * 0.015 * lvl; // acena falando
      head.rotation.set(rx, ry, rz);
    }
    if (neck && restPose.Neck) {
      neck.rotation.y = restPose.Neck.y + smx * 0.06;
      neck.rotation.x = restPose.Neck.x + smy * 0.04;
    }
    if (bones.Spine2 && restPose.Spine2) {                    // respiração
      bones.Spine2.rotation.x = restPose.Spine2.x + Math.sin(t * 1.35) * 0.01;
    }
  }

  /* ═════════ LOOP ═════════ */
  function animate() {
    if (!inited) return;
    requestAnimationFrame(animate);
    if (!active) return;                                      // pausado (modo esfera)
    const dt = Math.min(clock.getDelta(), 0.05);
    const t  = clock.getElapsedTime();
    const st = ELX.state;
    const lvl = (st === 'speaking' || st === 'live') ? ELX.audio.bands().level : 0;

    updateMouth(dt, st, t);
    updateMood(st, lvl);
    updateBlink(dt);
    updateEyes(dt, st);
    updateHead(dt, st, t, lvl);
    for (const m of CYB.mats) m.userData.uTime.value = t;   // pulso dos circuitos
    // holograma: grão anima com o tempo; boca acende com a ENERGIA da fala (suavizada)
    HOLO.spk += (lvl - HOLO.spk) * (lvl > HOLO.spk ? 0.5 : 0.12);
    for (const m of HOLO.mats) { m.userData.uTime.value = t; m.userData.uSpeak.value = Math.min(1, HOLO.spk * 1.7); }
    bones[neonEyeBone]?.getWorldPosition(HOLO.eye);           // olho embutido acompanha a cabeça (espaço-mundo)

    camera.lookAt(camTarget);
    renderer.render(scene, camera);
    fxDraw(t, dt);                                       // HUD holográfico do olho (2D, por cima)
  }

  /* ═════════ TOGGLE ESFERA ⇄ ROSTO ═════════ */
  function updateToggleUI() {
    if (loading) return;
    toggleBtn.textContent = active ? '◈ NÚCLEO' : '☺ ROSTO';
    toggleBtn.title = active
      ? 'voltar para a esfera neural'
      : 'assumir a forma ciborgue (clique-direito: trocar avatar GLB)';
  }
  function applyMode(mode) {
    active = mode === 'face' && !failed;
    canvas.style.display   = active ? 'block' : 'none';
    sphereCv.style.display = active ? 'none'  : 'block';
    if (active) { bgStart(); fxShow(); } else { bgStop(); fxHide(); }
    localStorage.setItem(LS_MODE, active ? 'face' : 'sphere');
    if (active && !inited) init();
    if (active && inited) { clock.getDelta(); resize(); }     // zera dt acumulado
    updateToggleUI();
  }

  toggleBtn.addEventListener('click', () => applyMode(active ? 'sphere' : 'face'));
  toggleBtn.addEventListener('contextmenu', e => {
    e.preventDefault();
    const cu = localStorage.getItem(LS_URL) || '';
    const u = prompt('URL/caminho de um GLB compatível (padrão Ready Player Me — morphs ARKit + Oculus visemes).\nVazio = avatar padrão.', cu);
    if (u === null) return;
    if (u.trim()) localStorage.setItem(LS_URL, u.trim()); else localStorage.removeItem(LS_URL);
    location.reload();
  });

  ELX.avatar = {
    get active() { return active; },
    /* `failed` fica exposto porque, quando o modelo 3D não carrega, applyMode
       deixa active em false SEM avisar ninguém. Pelo botão isso é visível — o
       rosto não aparece. Por comando de voz seria pior: o ELION diria "pronto,
       Senhor" e nada teria mudado. Quem chama precisa poder distinguir. */
    get failed() { return failed; },
    // devolvem o estado REAL depois da troca, não a intenção
    enable: () => { applyMode('face'); return active; },
    disable: () => { applyMode('sphere'); return !active; },
    toggle: () => { applyMode(active ? 'sphere' : 'face'); return active; },
    /** valores atuais dos morphs (diagnóstico do lip-sync) */
    morphs(filtro) {
      const out = {};
      for (const k in cur) {
        if (filtro && !new RegExp(filtro, 'i').test(k)) continue;
        if (cur[k] > 0.001) out[k] = +cur[k].toFixed(3);
      }
      return out;
    },
  };

  /* restaura a escolha do operador */
  if (localStorage.getItem(LS_MODE) === 'face') applyMode('face');
  else updateToggleUI();
})();
