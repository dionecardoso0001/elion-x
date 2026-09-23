/* ═══════════════════════════════════════════════════════════════════
   ELION-X v3 — Esfera Neural (Three.js r128)
   Núcleo de plasma com shader de ruído + teia poligonal + partículas
   conectadas. Reage em tempo real às frequências da voz do agente:
     graves  → pulso/expansão do núcleo
     médios  → intensidade da teia de polígonos
     agudos  → deslocamento de tom (ciano ↔ verde)
═══════════════════════════════════════════════════════════════════ */
(function () {
  const canvas = document.getElementById('sphereCanvas');
  const wrap   = document.getElementById('sphereWrap');

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  camera.position.set(0, 0, 4.3); // mais próximo → esfera maior, dominando o campo

  const CYAN  = new THREE.Color(0x00e5ff);
  const GREEN = new THREE.Color(0x00ff9d);
  const WHITE = new THREE.Color(0xffffff);

  /* ── ruído simplex 3D (Ashima) p/ shader ── */
  const NOISE = `
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }`;

  /* ── núcleo de plasma ── */
  const coreUniforms = {
    uTime:  { value: 0 },
    uAudio: { value: 0 },   // graves → deformação
    uMix:   { value: 0.25 },// 0 = ciano, 1 = verde
    uGlow:  { value: 0.8 },
  };
  const coreMat = new THREE.ShaderMaterial({
    uniforms: coreUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: NOISE + `
      uniform float uTime; uniform float uAudio;
      varying vec3 vNormal; varying vec3 vView; varying float vNoise;
      void main(){
        float n = snoise(position*2.3 + vec3(uTime*0.45));
        float n2 = snoise(position*5.0 - vec3(uTime*0.7)) * 0.4;
        vNoise = n + n2;
        float amp = 0.055 + uAudio*0.38;
        vec3 p = position + normal * (vNoise * amp);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uMix; uniform float uGlow; uniform float uAudio;
      varying vec3 vNormal; varying vec3 vView; varying float vNoise;
      void main(){
        vec3 cyan  = vec3(0.0, 0.898, 1.0);
        vec3 green = vec3(0.0, 1.0, 0.616);
        vec3 base = mix(cyan, green, clamp(uMix + vNoise*0.22, 0.0, 1.0));
        float fres = pow(1.0 - abs(dot(vNormal, vView)), 1.9);
        float energy = 0.18 + fres*1.35 + max(vNoise,0.0)*0.35 + uAudio*0.5;
        gl_FragColor = vec4(base * energy * uGlow, clamp(energy, 0.0, 1.0));
      }`,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 110, 110), coreMat);
  scene.add(core);

  /* ── atmosfera (halo fresnel) ── */
  const haloUniforms = { uMix: { value: 0.25 }, uGlow: { value: 0.55 } };
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.32, 64, 64),
    new THREE.ShaderMaterial({
      uniforms: haloUniforms,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      vertexShader: `
        varying vec3 vNormal; varying vec3 vView;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uMix; uniform float uGlow;
        varying vec3 vNormal; varying vec3 vView;
        void main(){
          vec3 cyan  = vec3(0.0, 0.898, 1.0);
          vec3 green = vec3(0.0, 1.0, 0.616);
          float fres = pow(1.0 - abs(dot(vNormal, vView)), 2.6);
          gl_FragColor = vec4(mix(cyan, green, uMix) * fres * uGlow * 2.2, fres * uGlow);
        }`,
    })
  );
  scene.add(halo);

  /* ── glow de fundo (sprite radial) ── */
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,229,255,0.55)');
    gr.addColorStop(0.35, 'rgba(0,255,180,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85,
  }));
  glowSprite.scale.set(6.4, 6.4, 1);
  scene.add(glowSprite);

  /* ── teia de polígonos (wireframe icosaédrico duplo) ── */
  const webMat1 = new THREE.MeshBasicMaterial({ color: CYAN.clone(), wireframe: true, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
  const webMat2 = new THREE.MeshBasicMaterial({ color: GREEN.clone(), wireframe: true, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false });
  const web1 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), webMat1);
  const web2 = new THREE.Mesh(new THREE.IcosahedronGeometry(1.78, 1), webMat2);
  scene.add(web1, web2);

  /* ── partículas em casca + conexões (teia de aranha) ── */
  const P_COUNT = 260;
  const pPos = new Float32Array(P_COUNT * 3);
  const pts = [];
  for (let i = 0; i < P_COUNT; i++) {
    // distribuição fibonacci na esfera com jitter de raio
    const t = i / P_COUNT;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 2.05 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.42;
    const v = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta) * 0.92,
      r * Math.cos(phi)
    );
    pts.push(v);
    pPos.set([v.x, v.y, v.z], i * 3);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));

  // núcleo quente e brilhante do nó (white-hot core → ciano)
  function dotTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0,    'rgba(255,255,255,1)');
    gr.addColorStop(0.14, 'rgba(225,255,255,1)');
    gr.addColorStop(0.32, 'rgba(120,245,255,0.95)');
    gr.addColorStop(0.6,  'rgba(0,229,255,0.55)');
    gr.addColorStop(1,    'rgba(0,229,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  // halo difuso para o efeito de bloom/reluzência ao redor de cada nó
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0,   'rgba(140,255,245,0.6)');
    gr.addColorStop(0.4, 'rgba(0,229,255,0.22)');
    gr.addColorStop(1,   'rgba(0,229,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  // textura NEUTRA para o halo reativo à voz (a cor pura vem do material)
  function nodeGlowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0,    'rgba(255,255,255,0.85)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1,    'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  // camada de halo (atrás) — luz VERDE sutil e fina que reage à voz do agente
  const pGlowMat = new THREE.PointsMaterial({
    size: 0.16, map: nodeGlowTex(), transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, color: GREEN.clone(),
  });
  const particleGlow = new THREE.Points(pGeo, pGlowMat);
  // núcleo nítido e brilhante (frente)
  const pMat = new THREE.PointsMaterial({
    size: 0.12, map: dotTexture(), transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, color: CYAN.clone(),
  });
  const particles = new THREE.Points(pGeo, pMat);

  // conexões: pares com distância < limiar
  const linkVerts = [];
  for (let i = 0; i < P_COUNT; i++) {
    let links = 0;
    for (let j = i + 1; j < P_COUNT && links < 4; j++) {
      if (pts[i].distanceTo(pts[j]) < 0.78) {
        linkVerts.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
        links++;
      }
    }
  }
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.Float32BufferAttribute(linkVerts, 3));
  const lMat = new THREE.LineBasicMaterial({ color: CYAN.clone(), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const links = new THREE.LineSegments(lGeo, lMat);

  const webGroup = new THREE.Group();
  webGroup.add(links, particleGlow, particles); // halo atrás, núcleo na frente
  scene.add(webGroup);

  /* ── ANEL DE BRASA LARANJA (limpo, sem distorção) em volta da esfera ──
     circunferência perfeita com brilho reluzente de brasa, surge quando ele fala */
  const ORANGE = new THREE.Color(0xff7a30);
  function emberRingTexture() {
    const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'); const cx = s / 2;
    const gr = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
    gr.addColorStop(0,    'rgba(0,0,0,0)');
    gr.addColorStop(0.66, 'rgba(255,120,30,0)');
    gr.addColorStop(0.74, 'rgba(255,170,70,0.95)');  // núcleo quente da brasa
    gr.addColorStop(0.80, 'rgba(255,90,25,0.55)');
    gr.addColorStop(0.95, 'rgba(255,70,15,0)');       // glow externo esmaece
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, cx, 0, 7); g.fill();
    return new THREE.CanvasTexture(c);
  }
  const emberMat = new THREE.SpriteMaterial({
    map: emberRingTexture(), color: ORANGE.clone(),
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const emberRing = new THREE.Sprite(emberMat);   // Sprite → sempre encara a câmera (anel perfeito)
  const EMBER_BASE = 4.0;                          // diâmetro → raio do anel ~1.45 (fora do halo, dentro da teia)
  emberRing.scale.set(EMBER_BASE, EMBER_BASE, 1);
  scene.add(emberRing);

  /* ── anel orbital equatorial ── */
  const ringGeo = new THREE.RingGeometry(2.62, 2.65, 128);
  const ringMat = new THREE.MeshBasicMaterial({ color: CYAN.clone(), side: THREE.DoubleSide, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2.25;
  scene.add(ring);

  /* ── poeira estelar de fundo ── */
  const S_COUNT = 750;
  const sPos = new Float32Array(S_COUNT * 3);
  for (let i = 0; i < S_COUNT; i++) {
    const r = 14 + Math.random() * 40;
    const a = Math.random() * Math.PI * 2;
    const b = Math.acos(2 * Math.random() - 1);
    sPos.set([r * Math.sin(b) * Math.cos(a), r * Math.sin(b) * Math.sin(a), -8 - Math.random() * 40], i * 3);
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const stars = new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 0.05, color: 0x3aa9c9, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(stars);

  /* ── BORBULHAS VERDES (pequenas) — sobem do centro da esfera conforme a voz ── */
  const BUB_MAX = 70;
  function bubbleTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0,   'rgba(255,255,255,0.95)'); // núcleo brilhante
    gr.addColorStop(0.4, 'rgba(180,255,225,0.55)');
    gr.addColorStop(1,   'rgba(0,255,157,0)');       // some nas bordas
    g.fillStyle = gr; g.beginPath(); g.arc(16, 16, 16, 0, 7); g.fill();
    return new THREE.CanvasTexture(c);
  }
  const bubPos   = new Float32Array(BUB_MAX * 3);
  const bubSize  = new Float32Array(BUB_MAX);
  const bubAlpha = new Float32Array(BUB_MAX);
  const bubGeo = new THREE.BufferGeometry();
  bubGeo.setAttribute('position', new THREE.BufferAttribute(bubPos, 3));
  bubGeo.setAttribute('aSize',  new THREE.BufferAttribute(bubSize, 1));
  bubGeo.setAttribute('aAlpha', new THREE.BufferAttribute(bubAlpha, 1));
  const bubMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: bubbleTexture() }, uColor: { value: new THREE.Color(0x00ff9d) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSize; attribute float aAlpha;
      varying float vAlpha;
      void main(){
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (34.0 / -mv.z);   // partículas PEQUENAS
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform vec3 uColor;
      varying float vAlpha;
      void main(){
        vec4 tex = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(uColor, 1.0) * tex * vAlpha;
      }`,
  });
  const bubbles = new THREE.Points(bubGeo, bubMat);
  bubbles.frustumCulled = false;
  scene.add(bubbles);

  // pool de borbulhas (estado em JS)
  const bub = Array.from({ length: BUB_MAX }, () => ({
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0, active: false,
  }));
  let bubAcc = 0;
  const BUB_R = 0.86; // raio interno da esfera onde as bolhas flutuam
  function spawnBubble(power) {
    const slot = bub.find(p => !p.active);
    if (!slot) return;
    // nasce num ponto aleatório DENTRO do volume da esfera (água azul)
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1);
    const rad = 0.12 + Math.random() * (BUB_R - 0.2);
    slot.x = rad * Math.sin(v) * Math.cos(u);
    slot.y = rad * Math.sin(v) * Math.sin(u);
    slot.z = rad * Math.cos(v);
    // flutuação MUITO gentil dentro da esfera (sobe devagar, deriva leve)
    slot.vx = (Math.random() - 0.5) * 0.14;
    slot.vy = 0.04 + Math.random() * 0.1 + power * 0.06;
    slot.vz = (Math.random() - 0.5) * 0.14;
    slot.maxLife = 1.6 + Math.random() * 1.6;
    slot.life = slot.maxLife;
    slot.size = 1.3 + Math.random() * 2.0 + power * 1.0; // pequenas
    slot.active = true;
  }
  function updateBubbles(dt, st, level, treble) {
    // geração ligada à frequência da voz (só quando o agente fala)
    if (st === 'speaking' || st === 'live') {
      // menos volume de borbulhas → não inunda/esconde a esfera
      bubAcc += (1.1 + level * 10 + treble * 5) * dt;
      while (bubAcc >= 1) { bubAcc -= 1; spawnBubble(Math.min(1, level * 1.1 + treble * 0.5)); }
    } else {
      bubAcc = 0;
    }
    for (let i = 0; i < BUB_MAX; i++) {
      const p = bub[i];
      if (!p.active) { bubAlpha[i] = 0; bubSize[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.active = false; bubAlpha[i] = 0; bubSize[i] = 0; continue; }
      p.vy += dt * 0.04;                                 // empuxo leve
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.x += Math.sin((p.life + i) * 3) * dt * 0.05;     // bamboleio sutil
      // mantém DENTRO da esfera: ao tocar a "parede", desliza de volta
      const R = Math.hypot(p.x, p.y, p.z);
      if (R > BUB_R) { const k = BUB_R / R; p.x *= k; p.y *= k; p.z *= k; p.vx *= -0.25; p.vy *= -0.25; p.vz *= -0.25; }
      const f = p.life / p.maxLife;                       // 1 → 0
      bubPos[i * 3] = p.x; bubPos[i * 3 + 1] = p.y; bubPos[i * 3 + 2] = p.z;
      bubAlpha[i] = Math.sin(f * Math.PI) * 0.75;         // fade-in/out suave
      bubSize[i] = p.size;
    }
    bubGeo.attributes.position.needsUpdate = true;
    bubGeo.attributes.aSize.needsUpdate = true;
    bubGeo.attributes.aAlpha.needsUpdate = true;
  }


  /* ══ ESPECTROS DE FUMAÇA — rastros luminosos que serpenteiam POR TODOS OS LADOS
     e ATRAVESSAM a esfera enquanto o ELION fala.
     · Cada wisp é uma trilha de 18 puffs volumétricos em fila indiana.
     · A trajetória é uma curva de Lissajous 3D com frequências incomensuráveis:
       nunca se repete e cruza tanto a superfície quanto o MIOLO do núcleo.
     · A cauda EXPANDE e esmaece — é assim que fumaça real se dissipa.
     · Cada puff gira sobre o próprio eixo (rotação no fragment shader) → turbilhão.
     · depthTest desligado: a fumaça atravessa o núcleo em vez de ser ocultada.
     Tudo num único Points = 1 draw call.                                      ══ */
  const WISP_N = 11, WISP_LEN = 30, SMOKE_V = WISP_N * WISP_LEN;  // trilhas LONGAS = rastro, não bolha
  function smokeTexture() {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // nuvem irregular: dezenas de bolhas difusas sobrepostas (contorno orgânico)
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.pow(rnd(), 0.55) * s * 0.24;          // concentra massa no centro
      const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
      const r = s * (0.09 + rnd() * 0.21);
      const al = 0.10 + rnd() * 0.18;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${al})`);
      gr.addColorStop(0.45, `rgba(238,251,255,${al * 0.5})`);
      gr.addColorStop(1, 'rgba(215,243,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // véu quente no miolo → dá o "reluzente" sem estourar a nuvem
    const core = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.34);
    core.addColorStop(0, 'rgba(255,255,255,0.34)');
    core.addColorStop(0.5, 'rgba(245,253,255,0.13)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.fillRect(0, 0, s, s);
    // máscara radial: extremidades 100% transparentes (sem borda quadrada visível)
    g.globalCompositeOperation = 'destination-in';
    const m = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(0.5, 'rgba(0,0,0,0.92)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = m; g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }
  const smPos = new Float32Array(SMOKE_V * 3);
  const smSize = new Float32Array(SMOKE_V);
  const smAlpha = new Float32Array(SMOKE_V);
  const smRot = new Float32Array(SMOKE_V);
  const smGeo = new THREE.BufferGeometry();
  smGeo.setAttribute('position', new THREE.BufferAttribute(smPos, 3));
  smGeo.setAttribute('aSize',  new THREE.BufferAttribute(smSize, 1));
  smGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smAlpha, 1));
  smGeo.setAttribute('aRot',   new THREE.BufferAttribute(smRot, 1));
  const smokeMat = new THREE.ShaderMaterial({
    // uH = altura do buffer: mantém a fumaça do mesmo tamanho relativo em
    // qualquer resolução (gl_PointSize é medido em pixels absolutos)
    uniforms: { uTex: { value: smokeTexture() }, uH: { value: 700 } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aSize; attribute float aAlpha; attribute float aRot;
      uniform float uH;
      varying float vAlpha; varying float vRot;
      void main(){
        vAlpha = aAlpha; vRot = aRot;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (34.0 / -mv.z) * (uH / 700.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      varying float vAlpha; varying float vRot;
      void main(){
        // gira o puff no próprio eixo — quebra a repetição da textura e cria turbilhão
        vec2 uv = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        uv = mat2(c, -s, s, c) * uv + 0.5;
        vec4 tex = texture2D(uTex, uv);
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0) * tex * vAlpha;
      }`,
  });
  const smokePoints = new THREE.Points(smGeo, smokeMat);
  smokePoints.frustumCulled = false;
  smokePoints.renderOrder = 3;
  scene.add(smokePoints);

  const wisps = Array.from({ length: WISP_N }, () => ({
    // amplitudes desiguais + frequências incomensuráveis = caminho que passa
    // pela superfície E pelo miolo, sem nunca repetir a mesma volta
    Ax: 1.5 + Math.random() * 1.1, Ay: 1.2 + Math.random() * 1.0, Az: 1.5 + Math.random() * 1.1,
    Fx: 0.29 + Math.random() * 0.25, Fy: 0.41 + Math.random() * 0.29, Fz: 0.35 + Math.random() * 0.27,
    Px: Math.random() * 6.283, Py: Math.random() * 6.283, Pz: Math.random() * 6.283,
    spd: 0.48 + Math.random() * 0.5,
    gap: 0.042 + Math.random() * 0.026,      // próximos o bastante p/ massa contínua, longe p/ alongar
    size: 17 + Math.random() * 9,            // volume de fumaça, sem virar mancha leitosa
    rot: Math.random() * 6.283, rotV: (Math.random() - 0.5) * 0.7,
    s: Math.random() * 60,
  }));
  let smokeFade = 0;
  function updateSmoke(dt, t, speakingNow, level) {
    const target = speakingNow ? 1 : 0;
    smokeFade += (target - smokeFade) * (target > smokeFade ? 0.045 : 0.022); // condensa e dissipa
    if (smokeFade < 0.002) {
      if (smAlpha[0] !== 0) { smAlpha.fill(0); smGeo.attributes.aAlpha.needsUpdate = true; }
      return;
    }
    for (let i = 0; i < WISP_N; i++) {
      const w = wisps[i];
      w.s += dt * w.spd * (1 + level * 0.8);         // a voz acelera o fluxo
      w.rot += dt * w.rotV;
      const puff = 1 + level * 0.35;
      for (let k = 0; k < WISP_LEN; k++) {
        const idx = i * WISP_LEN + k;
        const s = w.s - k * w.gap;                    // cada puff vem atrás do anterior
        const f = k / (WISP_LEN - 1);                 // 0 = cabeça · 1 = ponta da cauda
        // trajetória Lissajous 3D + turbulência fina (fumaça não anda em linha)
        const tb = 0.13 + f * 0.16;
        smPos[idx * 3]     = w.Ax * Math.sin(w.Fx * s + w.Px) + Math.sin(s * 2.7 + i * 1.7) * tb;
        smPos[idx * 3 + 1] = w.Ay * Math.sin(w.Fy * s + w.Py) + Math.sin(s * 3.3 + i * 2.9) * tb;
        smPos[idx * 3 + 2] = w.Az * Math.sin(w.Fz * s + w.Pz) + Math.sin(s * 2.1 + i * 0.9) * tb;
        // fumaça real: a cauda INCHA enquanto perde densidade
        smSize[idx]  = w.size * (0.5 + f * 1.25) * puff;
        // baixo por puff: são 30 sobrepostos — a DENSIDADE nasce do acúmulo aditivo.
        // A CABEÇA é atenuada: sem isso os primeiros puffs saturam e viram flash branco.
        const nariz = 0.62 + 0.38 * Math.min(1, f * 5);
        smAlpha[idx] = smokeFade * Math.pow(1 - f * 0.92, 1.1) * nariz * 0.42 * (0.82 + 0.18 * Math.sin(t * 2.3 + i));
        smRot[idx]   = w.rot + k * 0.22;              // giro progressivo → turbilhão
      }
    }
    smGeo.attributes.position.needsUpdate = true;
    smGeo.attributes.aSize.needsUpdate = true;
    smGeo.attributes.aAlpha.needsUpdate = true;
    smGeo.attributes.aRot.needsUpdate = true;
  }

  /* ══ LUZES CÓSMICAS CELESTIAIS — a vida do ELION-X.
     Duas camadas somadas sobre a fumaça, ambas pulsando com a voz:
       A) NÚCLEOS incandescentes que viajam DENTRO dos rastros (mesma trajetória
          dos wisps) — luz branca estourada com raios de difração estelar.
       B) POEIRA ESTELAR à deriva por todo o campo, cintilando fora de fase.
     Ambas em Points únicos (2 draw calls) e só existem enquanto ele fala.    ══ */
  function starTexture() {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), cx0 = s / 2;
    // corpo da luz: branco estourado no miolo esmaecendo em azul celeste
    const gr = g.createRadialGradient(cx0, cx0, 0, cx0, cx0, cx0);
    gr.addColorStop(0,    'rgba(255,255,255,1)');
    gr.addColorStop(0.07, 'rgba(255,255,255,0.96)');
    gr.addColorStop(0.17, 'rgba(226,246,255,0.5)');
    gr.addColorStop(0.42, 'rgba(190,231,255,0.14)');
    gr.addColorStop(1,    'rgba(160,215,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    // raios de difração — é o que faz o ponto ler como ESTRELA, não como bolinha
    g.globalCompositeOperation = 'lighter';
    const raio = (ang, len, w, a) => {
      g.save(); g.translate(cx0, cx0); g.rotate(ang);
      const lg = g.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0, `rgba(255,255,255,${a})`);
      lg.addColorStop(0.3, `rgba(228,247,255,${a * 0.38})`);
      lg.addColorStop(1, 'rgba(200,236,255,0)');
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
      g.restore();
    };
    for (let i = 0; i < 4; i++) raio(i * Math.PI / 2, cx0 * 0.96, s * 0.030, 0.9);            // cruz principal
    for (let i = 0; i < 4; i++) raio(Math.PI / 4 + i * Math.PI / 2, cx0 * 0.46, s * 0.014, 0.3); // diagonais
    return new THREE.CanvasTexture(c);
  }
  const starTex = starTexture();
  const lightVert = `
    attribute float aSize; attribute float aAlpha;
    uniform float uH;
    varying float vAlpha;
    void main(){
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (34.0 / -mv.z) * (uH / 700.0);
      gl_Position = projectionMatrix * mv;
    }`;
  const lightFrag = `
    uniform sampler2D uTex;
    varying float vAlpha;
    void main(){ gl_FragColor = vec4(1.0) * texture2D(uTex, gl_PointCoord) * vAlpha; }`;

  // ── A) NÚCLEOS que viajam dentro dos rastros de fumaça ──
  const CORE_PER_WISP = 5, CORE_V = WISP_N * CORE_PER_WISP;
  const coPos = new Float32Array(CORE_V * 3), coSize = new Float32Array(CORE_V), coAlpha = new Float32Array(CORE_V);
  const coGeo = new THREE.BufferGeometry();
  coGeo.setAttribute('position', new THREE.BufferAttribute(coPos, 3));
  coGeo.setAttribute('aSize',  new THREE.BufferAttribute(coSize, 1));
  coGeo.setAttribute('aAlpha', new THREE.BufferAttribute(coAlpha, 1));
  const coreLightMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: starTex }, uH: { value: 700 } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, vertexShader: lightVert, fragmentShader: lightFrag,
  });
  const coreLights = new THREE.Points(coGeo, coreLightMat);
  coreLights.frustumCulled = false; coreLights.renderOrder = 4;
  scene.add(coreLights);

  // ── B) POEIRA ESTELAR à deriva por todo o campo ──
  const DUST_N = 150;
  const duPos = new Float32Array(DUST_N * 3), duSize = new Float32Array(DUST_N), duAlpha = new Float32Array(DUST_N);
  const duGeo = new THREE.BufferGeometry();
  duGeo.setAttribute('position', new THREE.BufferAttribute(duPos, 3));
  duGeo.setAttribute('aSize',  new THREE.BufferAttribute(duSize, 1));
  duGeo.setAttribute('aAlpha', new THREE.BufferAttribute(duAlpha, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: starTex }, uH: { value: 700 } },
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, vertexShader: lightVert, fragmentShader: lightFrag,
  });
  const dust = new THREE.Points(duGeo, dustMat);
  dust.frustumCulled = false; dust.renderOrder = 4;
  scene.add(dust);

  const motes = Array.from({ length: DUST_N }, () => {
    // distribuídas em casca esférica ampla → "flutuam por toda a parte"
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1);
    const r = 1.1 + Math.random() * 2.6;
    return {
      x: r * Math.sin(v) * Math.cos(u), y: r * Math.sin(v) * Math.sin(u), z: r * Math.cos(v),
      dF: 0.18 + Math.random() * 0.42, dA: 0.10 + Math.random() * 0.30,   // deriva lenta
      ph: Math.random() * 6.283, tw: 1.6 + Math.random() * 4.4,            // fase e ritmo do cintilar
      size: 2.0 + Math.random() * 3.4,
    };
  });

  function updateLights(t, level, treble) {
    const fade = smokeFade;                     // acompanha a mesma respiração da fumaça
    if (fade < 0.002) {
      if (coAlpha[0] !== 0 || duAlpha[0] !== 0) {
        coAlpha.fill(0); duAlpha.fill(0);
        coGeo.attributes.aAlpha.needsUpdate = true; duGeo.attributes.aAlpha.needsUpdate = true;
      }
      return;
    }
    // A) núcleos: mesma curva dos wisps, ancorados no terço dianteiro do rastro
    for (let i = 0; i < WISP_N; i++) {
      const w = wisps[i];
      for (let j = 0; j < CORE_PER_WISP; j++) {
        const idx = i * CORE_PER_WISP + j;
        const s = w.s - j * (WISP_LEN * w.gap) / (CORE_PER_WISP + 1.6);
        coPos[idx * 3]     = w.Ax * Math.sin(w.Fx * s + w.Px);
        coPos[idx * 3 + 1] = w.Ay * Math.sin(w.Fy * s + w.Py);
        coPos[idx * 3 + 2] = w.Az * Math.sin(w.Fz * s + w.Pz);
        // pulsação própria + sobressalto com os agudos da voz
        const pulse = 0.62 + 0.38 * Math.sin(t * (2.4 + i * 0.31) + j * 1.7);
        const decai = 1 - j / (CORE_PER_WISP + 1);        // a cabeça é a mais viva
        coSize[idx]  = (8.5 + j * 0.9) * (0.85 + pulse * 0.4) * (1 + level * 0.55);
        coAlpha[idx] = fade * decai * pulse * (0.95 + level * 0.6 + treble * 0.3);
      }
    }
    // B) poeira: deriva senoidal lenta + cintilar fora de fase
    for (let i = 0; i < DUST_N; i++) {
      const m = motes[i];
      const dx = Math.sin(t * m.dF + m.ph) * m.dA;
      const dy = Math.sin(t * m.dF * 1.31 + m.ph * 1.7) * m.dA;
      const dz = Math.cos(t * m.dF * 0.87 + m.ph * 0.6) * m.dA;
      duPos[i * 3] = m.x + dx; duPos[i * 3 + 1] = m.y + dy; duPos[i * 3 + 2] = m.z + dz;
      const tw = 0.5 + 0.5 * Math.sin(t * m.tw + m.ph);
      duSize[i]  = m.size * (0.75 + tw * 0.85) * (1 + level * 0.4);
      duAlpha[i] = fade * (0.14 + tw * 0.72) * (0.65 + level * 0.75);
    }
    coGeo.attributes.position.needsUpdate = true;
    coGeo.attributes.aSize.needsUpdate = true;
    coGeo.attributes.aAlpha.needsUpdate = true;
    duGeo.attributes.position.needsUpdate = true;
    duGeo.attributes.aSize.needsUpdate = true;
    duGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* ── parallax do mouse ── */
  let mx = 0, my = 0, cx = 0, cy = 0;
  window.addEventListener('mousemove', e => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  /* ── resize ── */
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  /* ── loop ── */
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  let smooth = { bass: 0, mid: 0, treble: 0, level: 0 };
  let bootScale = 0.001;
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    if (canvas.style.display === 'none') return; // modo ROSTO ativo → economiza GPU
    const t = clock.getElapsedTime();
    const dt = Math.min(clock.getDelta() + 0.016, 0.05);
    const st = ELX.state;
    const b = ELX.audio.bands();

    // suavização
    const k = 0.16;
    smooth.bass   += (b.bass   - smooth.bass)   * k;
    smooth.mid    += (b.mid    - smooth.mid)    * k;
    smooth.treble += (b.treble - smooth.treble) * k;
    smooth.level  += (b.level  - smooth.level)  * k;

    // entrada no boot
    const targetScale = st === 'boot' ? 0.001 : 1;
    bootScale += (targetScale - bootScale) * 0.045;

    const speakingNow = st === 'speaking' || st === 'live';

    // respiração idle + pulso de áudio — REFINADO na fala (esfera de água azul calma)
    const breathe = 1 + Math.sin(t * 1.4) * 0.022;
    const audioPulse = 1 + smooth.bass * (speakingNow ? 0.06 : 0.34) + smooth.level * (speakingNow ? 0.025 : 0.06);
    core.scale.setScalar(bootScale * breathe * audioPulse);
    halo.scale.setScalar(bootScale * breathe * (1 + smooth.bass * (speakingNow ? 0.05 : 0.22)));
    // o sprite radial é o principal causador do "borrão" — encolhe e esmaece quando fala
    const glowBase = speakingNow ? 5.6 : 6.4;
    glowSprite.scale.setScalar(glowBase * bootScale * (1 + smooth.bass * (speakingNow ? 0.12 : 0.5) + Math.sin(t * 1.4) * 0.03));
    glowSprite.material.opacity = speakingNow ? 0.5 : 0.85;
    webGroup.scale.setScalar(bootScale);
    web1.scale.setScalar(bootScale * (1 + smooth.mid * 0.12));
    web2.scale.setScalar(bootScale * (1 + smooth.mid * 0.07));
    ring.scale.setScalar(bootScale);

    // tonalidade por estado + agudos
    let mixTarget, glowTarget;
    switch (st) {
      case 'listening': mixTarget = 0.88; glowTarget = 0.95; break;
      case 'thinking':  mixTarget = 0.5 + Math.sin(t * 5) * 0.32; glowTarget = 1.0; break;
      // fala: brilho mais ALTO e CONSTANTE (reluzente), com bem menos oscilação reativa
      case 'speaking':  mixTarget = 0.16 + smooth.treble * 0.16; glowTarget = 0.74 + smooth.level * 0.05; break;
      case 'live':      mixTarget = 0.24 + smooth.treble * 0.18; glowTarget = 0.76 + smooth.level * 0.05; break;
      default:          mixTarget = 0.22 + Math.sin(t * 0.6) * 0.07; glowTarget = 0.78;
    }
    coreUniforms.uMix.value  += (mixTarget - coreUniforms.uMix.value) * 0.08;
    coreUniforms.uGlow.value += (glowTarget - coreUniforms.uGlow.value) * 0.08;
    coreUniforms.uAudio.value = smooth.bass * (speakingNow ? 0.2 : 1.15) + (st === 'thinking' ? 0.12 : 0);
    coreUniforms.uTime.value  = t;
    haloUniforms.uMix.value   = coreUniforms.uMix.value;
    haloUniforms.uGlow.value  = (0.45 + smooth.level * 0.55) * (speakingNow ? 0.7 : 1);

    // cor da teia/partículas acompanha o tom
    tmpA.copy(CYAN).lerp(GREEN, coreUniforms.uMix.value);
    tmpB.copy(GREEN).lerp(CYAN, coreUniforms.uMix.value);
    webMat1.color.copy(tmpA); webMat2.color.copy(tmpB);
    pMat.color.copy(tmpA); lMat.color.copy(tmpA);
    ringMat.color.copy(tmpA);

    // vibração da teia refinada (mais sutil na fala)
    webMat1.opacity = 0.13 + smooth.mid * 0.22;
    webMat2.opacity = 0.06 + smooth.mid * 0.14;
    lMat.opacity    = 0.16 + smooth.mid * 0.22 + smooth.treble * 0.08;
    ringMat.opacity = 0.1 + smooth.level * 0.18;

    // ── pontinhos da teia: núcleo + halo verde MUITO sutil (quase constante) ──
    const twinkle = 0.9 + Math.sin(t * 3.1) * 0.1;
    pMat.size    = 0.12 + smooth.treble * 0.05;
    pMat.opacity = Math.min(1, 0.92 + smooth.level * 0.12);
    pGlowMat.color.copy(GREEN);
    pGlowMat.size    = 0.12 + smooth.bass * 0.05;
    pGlowMat.opacity = (0.2 + smooth.level * 0.05) * twinkle; // reluzência sutil e constante

    // ── ANEL DE BRASA LARANJA: circunferência limpa, brilho reluzente com a voz ──
    const emberFlicker = 0.82 + Math.sin(t * 7.0) * 0.09 + Math.sin(t * 17.0) * 0.06; // cintilação de brasa
    const emberTarget = speakingNow ? (0.34 + smooth.level * 0.26) * emberFlicker : 0;
    emberMat.opacity += (emberTarget - emberMat.opacity) * 0.13;
    emberRing.scale.setScalar(EMBER_BASE * bootScale * (1 + smooth.bass * 0.04)); // leve respiração, sem distorcer

    // borbulhas VERDES pequenas, flutuando DENTRO da esfera de água azul
    bubMat.uniforms.uColor.value.copy(GREEN).lerp(WHITE, 0.15);
    updateBubbles(dt, st, smooth.level, smooth.treble);

    // ESPECTROS DE FUMAÇA — condensam quando ele fala e atravessam a esfera
    smokePoints.scale.setScalar(bootScale);
    smokeMat.uniforms.uH.value = renderer.domElement.height || 700; // tamanho relativo à resolução
    updateSmoke(dt, t, speakingNow, smooth.level);
    // LUZES CÓSMICAS — núcleos dentro dos rastros + poeira estelar à deriva
    coreLights.scale.setScalar(bootScale); dust.scale.setScalar(bootScale);
    coreLightMat.uniforms.uH.value = dustMat.uniforms.uH.value = smokeMat.uniforms.uH.value;
    updateLights(t, smooth.level, smooth.treble);

    // rotações
    const spin = st === 'thinking' ? 3.2 : 1;
    core.rotation.y += dt * 0.12 * spin;
    web1.rotation.y -= dt * 0.16 * spin;
    web1.rotation.x += dt * 0.05;
    web2.rotation.y += dt * 0.1 * spin;
    web2.rotation.z -= dt * 0.04;
    webGroup.rotation.y += dt * (0.05 + smooth.mid * 0.25) * spin;
    webGroup.rotation.x = Math.sin(t * 0.2) * 0.12;
    ring.rotation.z += dt * 0.25;
    stars.rotation.y += dt * 0.006;

    // parallax suave
    cx += (mx - cx) * 0.04; cy += (my - cy) * 0.04;
    camera.position.x = cx * 0.55;
    camera.position.y = -cy * 0.4 + 0.1;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  animate();

  ELX.sphere = { scene, renderer };
})();
