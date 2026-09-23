/**
 * ELION-X · COSMOS — sistema solar cinematográfico em WebGL
 *
 * Por que WebGL e não canvas 2D: no 2D a "luz" é um degradê radial colado por
 * cima. Não existe normal, não existe incidência, não existe terminador — daí
 * a leitura de plástico. Aqui cada corpo é geometria esférica de verdade,
 * iluminada por uma fonte na posição do Sol, com o sombreamento calculado por
 * pixel no shader. É essa diferença que separa ilustração de fotografia.
 *
 * Superfícies são PROCEDURAIS (FBM em GLSL), não texturas de arquivo. Decisão
 * deliberada: evita depender de imagem externa, funciona offline, não levanta
 * questão de licença ou crédito e permite variação contínua sem costura.
 *
 * Fica ATRÁS do grafo de nós, que segue em canvas 2D — a malha cognitiva é a
 * informação; o cosmos é o palco.
 */
(() => {
  'use strict';
  if (typeof THREE === 'undefined') { console.warn('[cosmos] Three.js ausente'); return; }

  const cv = document.getElementById('cosmos');
  if (!cv) return;

  /* ─────────────── renderer: cor e tom cinematográficos ─────────────── */
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true,
                                             powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;          // r128: gerenciamento sRGB
  renderer.toneMapping = THREE.ACESFilmicToneMapping;    // curva de cinema
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 4000);
  /* A câmera fica poucos graus ACIMA do plano orbital (≈10°) e olha para dentro
     dele. É essa elevação baixa — não um achatamento aplicado à geometria — que
     produz a visão horizontal: as órbitas circulares se projetam como elipses
     rasas e os corpos se alinham numa faixa, como no Sistema Solar real visto
     de perto da eclíptica.

     O ROLL (camera.up inclinado) desce a ponta esquerda da faixa: é o mesmo
     enquadramento da referência — Sol em cima à direita, Terra e Lua embaixo à
     esquerda — e tem a vantagem prática de tirar os corpos do miolo, onde a
     malha de nós é mais densa. Inclinar a câmera não deforma nada; inclinar a
     geometria deformaria. */
  camera.position.set(0, 208, 1150);
  camera.up.set(Math.sin(0.22), Math.cos(0.22), 0);
  camera.lookAt(240, -25, -140);

  /* ─────────────── ruído compartilhado pelos shaders ─────────────── */
  const RUIDO = `
    vec3 hash3(vec3 p){
      p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
      return fract(sin(p)*43758.5453123)*2.0-1.0;
    }
    float ruido(vec3 p){
      vec3 i = floor(p), f = fract(p);
      vec3 u = f*f*(3.0-2.0*f);
      return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                     mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
                 mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                     mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
    }
    float fbm(vec3 p, int oit){
      float v=0.0, a=0.5;
      for(int i=0;i<8;i++){ if(i>=oit) break; v += ruido(p)*a; p*=2.03; a*=0.5; }
      return v;
    }
    // FBM com domínio deslocado por outro FBM: cria turbulência, não borrão
    float turb(vec3 p, int oit){
      vec3 q = vec3(fbm(p, 3), fbm(p+vec3(5.2,1.3,2.7), 3), fbm(p+vec3(1.7,9.2,4.4), 3));
      return fbm(p + 2.4*q, oit);
    }
  `;

  const VERT = `
    varying vec3 vN;      // normal em espaço de mundo
    varying vec3 vP;      // posição em espaço de mundo
    varying vec3 vL;      // posição local (para amostrar a superfície girando)
    uniform float uGiro;
    void main(){
      float c = cos(uGiro), s = sin(uGiro);
      vec3 pr = vec3(position.x*c - position.z*s, position.y, position.x*s + position.z*c);
      vL = normalize(pr);
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position,1.0);
      vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  /* superfícies por tipo — cada uma com sua física visual */
  const SUPERFICIE = {
    mercurio: `
      float m = fbm(vL*4.0, 5);
      float cr = fbm(vL*14.0, 4);
      vec3 base = mix(vec3(0.42,0.40,0.38), vec3(0.24,0.23,0.22), m);
      base *= 0.85 + 0.30*smoothstep(0.35,0.65,cr);
      cor = base;`,
    venus: `
      float n = turb(vL*3.2 + vec3(0.0, uT*0.010, 0.0), 6);
      float faixa = 0.5+0.5*sin(vL.y*7.0 + n*3.4);
      cor = mix(vec3(0.86,0.68,0.38), vec3(0.98,0.92,0.74), n*0.65+faixa*0.35);`,
    marte: `
      float largo = fbm(vL*2.6, 5);
      float fino  = fbm(vL*12.0, 4);
      vec3 claro = vec3(0.86,0.56,0.36), escuro = vec3(0.34,0.18,0.13);
      cor = mix(escuro, claro, smoothstep(0.30,0.72,largo));
      cor *= 0.90 + 0.20*fino;
      float gelo = smoothstep(0.86,0.97,abs(vL.y));
      cor = mix(cor, vec3(0.94,0.93,0.90), gelo);`,
    jupiter: `
      float onda = turb(vec3(vL.x*1.2, vL.y*5.0, vL.z*1.2) + vec3(uT*0.006,0.0,0.0), 5);
      float lat = vL.y + (onda-0.5)*0.16;
      float f = 0.5+0.5*sin(lat*17.0);
      vec3 claro = vec3(0.92,0.84,0.70), escuro = vec3(0.58,0.36,0.21);
      cor = mix(escuro, claro, f);
      cor = mix(cor, claro*1.06, (turb(vL*7.0,4)-0.5)*0.5);
      // Grande Mancha Vermelha
      vec2 d = vec2((atan(vL.z,vL.x)/6.2831 + 0.30), vL.y + 0.22);
      d.x = fract(d.x+0.5)-0.5;
      float g = 1.0 - smoothstep(0.0, 1.0, length(vec2(d.x*3.2, d.y*7.0)));
      cor = mix(cor, vec3(0.72,0.32,0.20), g*0.92);`,
    saturno: `
      float onda = turb(vec3(vL.x*1.1, vL.y*4.2, vL.z*1.1) + vec3(uT*0.004,0.0,0.0), 5);
      float f = 0.5+0.5*sin((vL.y+(onda-0.5)*0.14)*13.0);
      cor = mix(vec3(0.72,0.62,0.42), vec3(0.95,0.90,0.74), f);`,
    urano: `
      float n = turb(vL*2.4 + vec3(0.0,uT*0.004,0.0), 5);
      float f = 0.5+0.5*sin(vL.y*7.0+n*1.6);
      cor = mix(vec3(0.55,0.80,0.83), vec3(0.78,0.94,0.95), f*0.55+n*0.45);`,
    netuno: `
      float n = turb(vL*2.8 + vec3(0.0,uT*0.006,0.0), 5);
      float f = 0.5+0.5*sin(vL.y*9.0+n*2.2);
      cor = mix(vec3(0.10,0.22,0.62), vec3(0.34,0.55,0.92), f*0.5+n*0.5);
      vec2 d = vec2(fract(atan(vL.z,vL.x)/6.2831 + 0.62 + 0.5)-0.5, vL.y-0.26);
      float g = 1.0 - smoothstep(0.0,1.0, length(vec2(d.x*3.6, d.y*8.0)));
      cor = mix(cor, vec3(0.05,0.10,0.34), g*0.72);`,
    /* LUA ROCHOSA. O branco vem do albedo alto dos planaltos; o realismo vem
       do RELEVO: a cor é modulada pela derivada direcional do campo de
       crateras NA DIREÇÃO DA LUZ — encosta virada para a luz clareia,
       contra-encosta escurece. Sem normal map, sem textura: a sombra da
       cratera nasce da mesma matemática que a esculpiu. */
    lua: `
      float m   = fbm(vL*3.2, 5);
      float cr1 = fbm(vL*16.0, 4);
      float cr2 = fbm(vL*34.0, 3);
      vec3 alt2 = vec3(0.94,0.94,0.91), mar2 = vec3(0.52,0.54,0.60);
      cor = mix(alt2, mar2, smoothstep(0.50,0.74,m));
      vec3 Lrel = normalize(uSol - vP);
      float h0 = cr1*0.7 + cr2*0.3;
      float h1 = fbm((vL + Lrel*0.035)*16.0, 4)*0.7 + fbm((vL + Lrel*0.035)*34.0, 3)*0.3;
      cor *= clamp(1.0 + (h1 - h0)*2.8, 0.45, 1.55);
      // borda de cratera: anel estreito no topo do campo, batido pelo sol raso
      float borda = smoothstep(0.58,0.72,cr1) * (1.0 - smoothstep(0.72,0.86,cr1));
      cor += vec3(0.09) * borda;`,
    plutao: `
      float m = fbm(vL*3.6, 5);
      cor = mix(vec3(0.62,0.54,0.44), vec3(0.32,0.27,0.22), m);
      cor *= 0.88 + 0.24*fbm(vL*15.0,3);`,
  };

  /* ─────────────── planeta rochoso/gasoso genérico ─────────────── */
  function fazPlaneta(tipo, raio) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT:{value:0}, uGiro:{value:Math.random()*6.28}, uSol:{value:new THREE.Vector3()} },
      vertexShader: VERT,
      fragmentShader: `
        precision highp float;
        varying vec3 vN; varying vec3 vP; varying vec3 vL;
        uniform float uT; uniform vec3 uSol;
        ${RUIDO}
        void main(){
          vec3 cor;
          ${SUPERFICIE[tipo] || 'cor = vec3(0.5);'}
          vec3 N = normalize(vN);
          vec3 L = normalize(uSol - vP);
          // LAMBERT com terminador suavizado — a borda dura denuncia render pobre
          float dif = dot(N,L);
          float luz = smoothstep(-0.22, 0.34, dif);
          // luz rasante avermelhada no terminador, como no nascer do sol visto do espaço
          float rasante = smoothstep(0.0,0.30,dif) * (1.0-smoothstep(0.30,0.72,dif));
          vec3 quente = vec3(1.0,0.66,0.40) * rasante * 0.22;
          // escurecimento de limbo: perda de luz na borda do disco
          vec3 V = normalize(cameraPosition - vP);
          float limbo = pow(max(dot(N,V),0.0), 0.42);
          vec3 fin = cor * (luz*1.16 + 0.055) * limbo + quente;
          // #luzdebug na URL: só o Lambert, sem albedo — separa "sombra da
          // luz" de "mancha escura da superfície" quando um corpo parece
          // iluminado do lado errado
          ${location.hash === '#luzdebug' ? 'fin = vec3(luz);' : ''}
          gl_FragColor = vec4(fin, 1.0);
        }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(raio, 96, 64), mat);
    m.userData.mat = mat;
    return m;
  }

  /* ─────────────── TERRA: quatro camadas independentes ─────────────── */
  function fazTerra(raio) {
    const grupo = new THREE.Group();

    const matSolo = new THREE.ShaderMaterial({
      uniforms: { uT:{value:0}, uGiro:{value:1.2}, uSol:{value:new THREE.Vector3()} },
      vertexShader: VERT,
      fragmentShader: `
        precision highp float;
        varying vec3 vN; varying vec3 vP; varying vec3 vL;
        uniform float uT; uniform vec3 uSol;
        ${RUIDO}
        void main(){
          // continentes: uma oitava larga manda na forma, as finas rendilham a costa
          float forma = fbm(vL*1.9, 3)*0.70 + fbm(vL*4.6, 3)*0.22 + fbm(vL*11.0, 3)*0.08;
          float lat = abs(vL.y);
          float cont = forma + 0.10 - lat*0.13;
          float terra = smoothstep(0.495, 0.525, cont);      // costa curta = litoral nítido
          vec3 oceano = mix(vec3(0.03,0.12,0.30), vec3(0.02,0.05,0.16),
                            smoothstep(0.30,0.50,0.52-cont));
          vec3 selva = vec3(0.09,0.24,0.10), campo = vec3(0.26,0.31,0.13),
               deserto = vec3(0.55,0.44,0.24), serra = vec3(0.34,0.31,0.27);
          vec3 solo = mix(selva, campo, smoothstep(0.05,0.42,lat));
          solo = mix(solo, deserto, smoothstep(0.14,0.34,lat)*0.75);
          solo = mix(solo, serra, smoothstep(0.53,0.60,cont));
          vec3 cor = mix(oceano, solo, terra);
          float gelo = smoothstep(0.80,0.93,lat);
          cor = mix(cor, vec3(0.86,0.90,0.94), gelo);

          vec3 N = normalize(vN);
          vec3 L = normalize(uSol - vP);
          float dif = dot(N,L);
          float luz = smoothstep(-0.20, 0.30, dif);

          /* LUZES NOTURNAS — não são enfeite, são o que salva a composição.
             A Terra é o corpo mais perto da câmera, e estar perto obriga a um
             ângulo de fase alto: geometricamente, dois terços do disco caem na
             noite. Sem as cidades acesas, o protagonista do quadro é uma bola
             preta. Duas escalas de ruído: aglomerados grandes (metrópoles) e
             pontilhado fino (cidades menores), só em terra e fora dos polos. */
          float noite = 1.0 - smoothstep(-0.16, 0.10, dif);
          float aglom = smoothstep(0.50, 0.74, fbm(vL*9.0, 4));
          float fina  = smoothstep(0.54, 0.80, fbm(vL*26.0, 4));
          float cidades = (aglom*0.65 + fina*0.85) * aglom * terra
                        * (1.0 - smoothstep(0.50,0.70,lat));
          vec3 brilho = vec3(1.0,0.82,0.50) * cidades * noite * 3.40;
          // brilho-de-ar: a alta atmosfera não apaga de vez, e é isso que
          // impede o lado noturno de virar um buraco recortado no espaço
          float aro = pow(1.0 - abs(dot(N, normalize(cameraPosition - vP))), 3.0);
          brilho += vec3(0.16,0.34,0.62) * aro * noite * 0.55;

          // reflexo especular do oceano — só na água, e estreito
          vec3 V = normalize(cameraPosition - vP);
          vec3 H = normalize(L+V);
          float esp = pow(max(dot(N,H),0.0), 90.0) * (1.0-terra) * luz * 0.55;

          float rasante = smoothstep(0.0,0.26,dif)*(1.0-smoothstep(0.26,0.66,dif));
          float limbo = pow(max(dot(N,V),0.0), 0.40);
          // piso de 0.085 e não 0.050: luz cinzenta refletida pela Lua e pela
          // poeira interplanetária. Mantém os continentes legíveis na sombra.
          vec3 fin = cor*(luz*1.14+0.085)*limbo + brilho + esp
                   + vec3(1.0,0.55,0.32)*rasante*0.16;
          gl_FragColor = vec4(fin,1.0);
        }`,
    });
    const solo = new THREE.Mesh(new THREE.SphereGeometry(raio, 128, 84), matSolo);
    grupo.add(solo);

    // NUVENS: esfera própria, girando em ritmo diferente do solo
    const matNuvem = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uT:{value:0}, uGiro:{value:0}, uSol:{value:new THREE.Vector3()} },
      vertexShader: VERT,
      fragmentShader: `
        precision highp float;
        varying vec3 vN; varying vec3 vP; varying vec3 vL;
        uniform float uT; uniform vec3 uSol;
        ${RUIDO}
        void main(){
          float n = turb(vL*3.0 + vec3(0.0,uT*0.004,0.0), 5);
          float cint = 0.5+0.5*sin(vL.y*6.2);          // cinturões equatoriais
          float d = n*0.78 + cint*0.22;
          float a = smoothstep(0.54, 0.80, d);
          if(a < 0.01) discard;
          vec3 N=normalize(vN), L=normalize(uSol-vP);
          float luz = smoothstep(-0.18,0.30,dot(N,L));
          gl_FragColor = vec4(vec3(1.0,0.99,0.98)*(luz*1.05+0.02), a*0.80);
        }`,
    });
    const nuvem = new THREE.Mesh(new THREE.SphereGeometry(raio*1.016, 96, 64), matNuvem);
    grupo.add(nuvem);

    grupo.userData = { solo, nuvem, matSolo, matNuvem };
    return grupo;
  }

  /* ─────────────── ATMOSFERA: casca invertida com Fresnel ─────────────── */
  function fazAtmosfera(raio, cor, forca) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      uniforms: { uSol:{value:new THREE.Vector3()}, uCor:{value:new THREE.Color(cor)}, uF:{value:forca} },
      vertexShader: `
        varying vec3 vN; varying vec3 vP;
        void main(){ vN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz;
          gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `
        precision highp float;
        varying vec3 vN; varying vec3 vP;
        uniform vec3 uSol; uniform vec3 uCor; uniform float uF;
        void main(){
          vec3 N=normalize(vN), V=normalize(cameraPosition-vP), L=normalize(uSol-vP);
          // a casca é BackSide: a normal aponta para dentro, daí o sinal invertido
          float fres = pow(1.0 - abs(dot(N,V)), 3.0);
          float luz = smoothstep(-0.42, 0.42, dot(-N,L));     // só brilha do lado do Sol
          gl_FragColor = vec4(uCor, fres*luz*uF);
        }`,
    });
    return new THREE.Mesh(new THREE.SphereGeometry(raio, 64, 48), mat);
  }

  /* ─────────────── ANÉIS DE SATURNO: geometria com alfa radial ─────────────── */
  function fazAneis(rInt, rExt, raioPlaneta) {
    const geo = new THREE.RingGeometry(rInt, rExt, 256, 8);
    // reescreve UV para que u seja o RAIO normalizado (o padrão do RingGeometry não serve)
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      uv.setXY(i, (Math.hypot(x, y) - rInt) / (rExt - rInt), 0.5);
    }
    const mat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
      uniforms: { uSol:{value:new THREE.Vector3()}, uCentro:{value:new THREE.Vector3()},
                  uRp:{value:raioPlaneta} },
      vertexShader: `
        varying vec2 vUv; varying vec3 vP;
        void main(){ vUv=uv; vec4 wp=modelMatrix*vec4(position,1.0); vP=wp.xyz;
          gl_Position=projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv; varying vec3 vP;
        uniform vec3 uSol; uniform vec3 uCentro; uniform float uRp;
        ${RUIDO}
        void main(){
          float r = vUv.x;
          // divisões: a de Cassini é a larga; as finas dão textura de partícula
          float dens = 0.55 + 0.45*sin(r*54.0);
          dens *= smoothstep(0.00,0.06,r) * (1.0-smoothstep(0.90,1.00,r));
          dens *= 1.0 - 0.92*smoothstep(0.40,0.46,r)*(1.0-smoothstep(0.52,0.58,r)); // Cassini
          dens *= 0.75 + 0.45*fbm(vec3(r*180.0, 0.0, 0.0), 3);
          vec3 cor = mix(vec3(0.52,0.45,0.34), vec3(0.88,0.82,0.66), 0.35+0.65*fract(r*7.0));
          // SOMBRA DO PLANETA sobre o anel: distância do ponto ao eixo Sol→centro
          vec3 dir = normalize(uCentro - uSol);
          vec3 rel = vP - uSol;
          float t = dot(rel, dir);
          float d = length(rel - dir*t);
          float sombra = (t > 0.0) ? smoothstep(uRp*1.06, uRp*0.72, d) : 0.0;
          float luz = 1.0 - sombra*0.90;
          gl_FragColor = vec4(cor*luz, clamp(dens,0.0,1.0)*0.92);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = Math.PI / 2;
    m.userData.mat = mat;
    return m;
  }

  /* ─────────────── SOL: plasma animado + coroa ─────────────── */
  /* Vértices do Sol FERVEM: duas escalas de células empurram a casca para
     dentro e para fora, então o próprio CONTORNO do disco borbulha — é o que
     separa "esfera com textura de fogo" de "bola de plasma viva". A foto tem
     silhueta perfeita; o Sol de verdade, não. */
  const SOL_VERT = `
    varying vec3 vN; varying vec3 vP; varying vec3 vL;
    uniform float uGiro; uniform float uT;
    ${RUIDO}
    void main(){
      float c = cos(uGiro), s = sin(uGiro);
      vec3 pr = vec3(position.x*c - position.z*s, position.y, position.x*s + position.z*c);
      vec3 n = normalize(pr);
      vL = n;
      float bolhaG = fbm(n*3.0 + vec3(0.0, uT*0.16, 0.0), 3) - 0.5;   // marulho largo
      float bolhaP = fbm(n*7.5 - vec3(uT*0.12, 0.0, uT*0.08), 3) - 0.5; // fervura miúda
      vec3 pd = position * (1.0 + bolhaG*0.045 + bolhaP*0.025);
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(pd, 1.0);
      vP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  function fazSol(raio) {
    const g = new THREE.Group();
    const matS = new THREE.ShaderMaterial({
      uniforms: { uT:{value:0}, uGiro:{value:0} },
      vertexShader: SOL_VERT,
      fragmentShader: `
        precision highp float;
        varying vec3 vN; varying vec3 vP; varying vec3 vL;
        uniform float uT;
        ${RUIDO}
        void main(){
          // duas escalas de convecção em ritmos diferentes: a superfície nunca repete.
          // Velocidades ~7x maiores que a primeira versão: em ritmo geológico a
          // animação existia mas o olho lia uma FOTO — vivo é o que se percebe em segundos.
          float gran = turb(vL*7.0 + vec3(0.0, uT*0.20, 0.0), 5);
          float sup  = turb(vL*2.4 - vec3(0.0, uT*0.10, 0.0), 4);

          /* FOGO CORRENDO PELA ESFERA.
             O domínio é deslocado por um segundo campo que ele mesmo avança no
             tempo — as línguas não piscam no lugar, elas ESCORREM pela
             superfície, contornando e se rompendo, como plasma de verdade. */
          vec3 fluxo = vec3(fbm(vL*3.1 + vec3(uT*0.30, 0.0, uT*0.17), 3),
                            fbm(vL*3.1 + vec3(2.7, uT*0.26, 1.3), 3),
                            fbm(vL*3.1 + vec3(4.1, 0.9, uT*0.21), 3)) - 0.5;
          float chama = turb(vL*5.2 + fluxo*3.4 + vec3(0.0, uT*0.42, 0.0), 5);
          chama = pow(smoothstep(0.34, 0.86, chama), 1.5);

          /* ONDAS VIAJANTES: duas frentes de pressão cruzando a esfera em
             direções diferentes, entortadas por ruído para não parecerem
             listras. O produto das duas cria interferência — cristas que se
             encontram, se somam e se desfazem, como marulho de plasma. */
          float onda = (0.5 + 0.5*sin(dot(vL, vec3(0.80,0.35,0.50))*11.0 - uT*1.5 + fbm(vL*2.6,2)*5.0))
                     * (0.5 + 0.5*sin(dot(vL, vec3(-0.45,0.60,0.66))*8.0 + uT*1.1));

          /* BORBULHAS DE FOGO — cada célula tem um CICLO próprio: incha,
             estoura no clarão e morre, cadenciada pela fase que sai do ruído.
             Não é cintilação aleatória; é fervura, com nascimento e colapso. */
          float cel  = fbm(vL*11.0 + fluxo*1.2, 4);          // onde ficam as bolhas
          float faseC = fbm(vL*11.0 + vec3(17.3, 5.1, 9.7), 2);
          float ciclo = fract(uT*0.16 + faseC*3.0);
          float bolha = smoothstep(0.0, 0.30, ciclo) * (1.0 - smoothstep(0.45, 1.0, ciclo));
          float brasa = smoothstep(0.55, 0.88, cel) * bolha;

          float e = gran*0.34 + sup*0.18 + chama*0.26 + brasa*0.16 + onda*0.10;
          // fundo mais escuro que antes: sem vale não há crista — o contraste
          // entre a base e a língua de fogo é o que faz a superfície FERVER
          vec3 fundo  = vec3(0.92,0.26,0.02);
          vec3 medio  = vec3(1.00,0.60,0.12);
          vec3 quente = vec3(1.00,0.93,0.68);
          vec3 cor = mix(fundo, medio, smoothstep(0.30,0.58,e));
          cor = mix(cor, quente, smoothstep(0.58,0.86,e));
          // manchas: convecção suprimida
          float ma = turb(vL*1.7 + vec3(3.0,uT*0.006,0.0), 4);
          cor = mix(cor, vec3(0.42,0.11,0.02), smoothstep(0.70,0.86,ma)*0.85);
          // crista da chama: o topo da língua queima quase branco
          cor = mix(cor, vec3(1.00,0.97,0.86), pow(chama, 2.6)*0.85);
          // núcleo da brasa: incandescência que respira, do vermelho ao branco
          cor = mix(cor, vec3(1.00,0.88,0.58), pow(brasa, 1.8)*0.75);
          cor += vec3(1.00,0.42,0.10) * pow(brasa, 3.0) * 0.55;
          // escurecimento de limbo — o Sol real é bem mais escuro na borda
          vec3 V = normalize(cameraPosition - vP);
          float limbo = pow(max(dot(normalize(vN),V),0.0), 0.55);
          cor *= 0.55 + 0.85*limbo;
          /* ARO CROMOSFÉRICO. O escurecimento de limbo deixa a borda do disco
             mais escura que a coroa aditiva que a envolve — e o degrau entre as
             duas aparece como uma costura nítida contornando o Sol. A cromosfera
             real é justamente uma faixa MAIS brilhante no limbo: acender esse
             aro é ao mesmo tempo o conserto e o fenômeno. */
          float aro = pow(1.0 - max(dot(normalize(vN),V), 0.0), 3.0);
          cor += vec3(1.00,0.52,0.14) * aro * 1.10;
          gl_FragColor = vec4(cor*1.5, 1.0);
        }`,
    });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(raio, 128, 84), matS));

    /* CORONA em painel que encara a câmera, NÃO em cascas concêntricas.
       Cada casca esférica com Fresnel gera um anel visível na sua borda — o
       resultado eram argolas de cebola em volta do Sol. Um painel único com
       queda radial contínua resolve, e ainda custa um draw call em vez de
       quatro. */
    const matC = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv; uniform float uT;
        ${RUIDO}
        void main(){
          vec2 d = vUv*2.0-1.0;
          float r = length(d);
          if(r > 1.0) discard;
          float ang = atan(d.y, d.x);
          // línguas de plasma: ruído ao longo do ângulo, deslizando devagar
          float ling = 0.72 + 0.55*fbm(vec3(cos(ang)*2.2, sin(ang)*2.2, uT*0.30), 4);
          // duas quedas somadas: o núcleo fecha rápido, o halo se estende
          float perto = pow(max(0.0, 1.0 - r/0.34), 2.2);
          float longe = pow(max(0.0, 1.0 - r), 2.6);
          float a = (perto*0.85 + longe*0.42) * ling;
          // pulsação com dois senos incomensuráveis: nunca se repete igual
          a *= 0.88 + 0.12*sin(uT*0.9)*(0.6+0.4*sin(uT*0.41));
          vec3 cor = mix(vec3(1.0,0.42,0.08), vec3(1.0,0.86,0.52), pow(max(0.0,1.0-r),1.8));
          gl_FragColor = vec4(cor, clamp(a,0.0,1.0)*1.45);
        }`,
    });
    const painel = new THREE.Mesh(new THREE.PlaneGeometry(raio * 9.0, raio * 9.0), matC);
    painel.onBeforeRender = (r, s, cam) => painel.quaternion.copy(cam.quaternion); // sempre de frente
    g.add(painel);
    g.userData = { matS, coroas: [matC] };
    return g;
  }

  /* Estrela é PONTO, não quadradinho. O PointsMaterial sem mapa desenha o
     sprite inteiro — quadrados brancos espalhados pelo céu, o detalhe que
     mais denuncia render amador. Um disco com queda suave resolve. */
  const DISCO = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0.00, 'rgba(255,255,255,1)');
    rg.addColorStop(0.22, 'rgba(255,255,255,0.92)');
    rg.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    rg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(32, 32, 32, 0, 7); g.fill();
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  })();

  /* ─────────────── campo estelar em três camadas de parallax ─────────────── */
  function fazEstrelas(qtd, raio, tam, brilho) {
    const pos = new Float32Array(qtd * 3), cor = new Float32Array(qtd * 3);
    const c = new THREE.Color();
    for (let i = 0; i < qtd; i++) {
      // distribuição não uniforme: aglomera em faixas, como a Via Láctea
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = raio * (0.75 + Math.random() * 0.25);
      const s = Math.sqrt(1 - u * u) * (0.55 + 0.45 * Math.pow(Math.random(), 0.4));
      pos[i*3] = r*s*Math.cos(th); pos[i*3+1] = r*u*0.55; pos[i*3+2] = r*s*Math.sin(th);
      // temperatura de cor: da anã vermelha à azul
      const t = Math.random();
      c.setHSL(t < 0.55 ? 0.08 + Math.random()*0.06 : (t < 0.88 ? 0.14 : 0.58),
               t < 0.55 ? 0.55 : 0.35, 0.62 + Math.random()*0.32);
      cor[i*3]=c.r; cor[i*3+1]=c.g; cor[i*3+2]=c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cor, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({
      size: tam, sizeAttenuation: true, vertexColors: true, map: DISCO,
      transparent: true, opacity: brilho, depthWrite: false, alphaTest: 0.01,
      blending: THREE.AdditiveBlending,
    }));
  }


  /* ─────────────── órbita: circunferência real no plano da eclíptica ───────────────
     Nada de elipse desenhada à mão. O anel é um CÍRCULO verdadeiro no plano
     horizontal x-z, centrado no Sol. Quem o achata na tela é a câmera, posta
     poucos graus acima do plano — a mesma razão pela qual o Sistema Solar
     aparece como uma faixa fina no céu. Achatar por fator seria desenhar a
     perspectiva à mão e brigar com a que o renderer já calcula. */
  function fazOrbita(raio, centro, alt) {
    const pts = [];
    for (let i = 0; i <= 512; i++) {
      const a = i / 512 * Math.PI * 2;
      pts.push(new THREE.Vector3(centro.x + Math.cos(a) * raio, centro.y + (alt || 0),
                                 centro.z + Math.sin(a) * raio));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0x8fb8d8, transparent: true, opacity: 0.16, depthWrite: false,
    }));
  }

  /* ═══════════════ MONTAGEM DA CENA ═══════════════ */
  /* VISÃO HORIZONTAL (a da referência): todos os corpos partilham UM plano — a
     eclíptica — e a câmera olha quase rente a ele. Daí a leitura de "sistema
     visto de lado", e não do anel de frente que havia antes.

     Escala CINEMATOGRÁFICA comprimida: não é escala astronômica. As distâncias
     reais tornariam os planetas invisíveis; a ordem é preservada, as proporções
     não. Todos os corpos têm o MESMO raio físico — a diferença de tamanho na
     tela é só perspectiva: quem está à frente no plano ocupa mais pixels. É por
     isso que a coluna decisiva aqui é a FASE, que põe o corpo no arco próximo
     (grande, à frente) ou no arco distante (pequeno, atrás do Sol).

     As fases ficam todas no semicírculo à ESQUERDA do Sol, e o movimento é de
     LIBRAÇÃO (vai-e-vem sobre a órbita), não revolução completa: revolução
     levaria cada corpo para trás do Sol e para fora do quadro, e o operador
     pediu explicitamente que nenhum planeta suma do campo de visão.

     Órbita, fase e altura NÃO foram escolhidas a olho: saíram de uma busca que
     mirou a posição e o raio de cada corpo EM COORDENADAS DE TELA, com veto
     explícito para qualquer corpo que passasse à frente do disco solar — foi
     esse cruzamento que transformava três planetas em silhuetas pretas.

     O terceiro critério da busca é o ÂNGULO DE FASE — o ângulo, aberto no
     corpo, entre a direção do Sol e a da câmera. Ele decide quanto do disco
     aparece iluminado, e é o que faltava na primeira montagem: com todos os
     corpos perto de 180° o campo virou uma fileira de bolas pretas. Aqui todos
     ficam entre 57° e 107°, ou seja, de meio disco a três quartos iluminados,
     com o terminador cortando o corpo — a leitura de realismo da referência. */
  const R_CORPO = 62;
  const CORPOS = [
    // nome      órbita   fase    alt   giro   atmosfera(cor, força)  // tela x/y · raio · fase
    /* FILEIRA NA ORDEM REAL do Sistema Solar: Mercúrio é o vizinho do Sol e
       Plutão fecha a fila — repare que a coluna 'órbita' sai CRESCENTE, como
       manda a física. Todos com o mesmo tamanho aparente da Terra: duas
       profundidades alternadas (1050/1180) e zigue-zague vertical suave, que
       separam vizinhos em 3D sem quebrar a leitura de fileira.
       Valores calculados por unprojeção (scratchpad/tabela.mjs), não a olho. */
    ['mercurio',   587,  2.533,  -25,  0.05, null],                   // .66 .50
    ['venus',      561,  2.843,   10,  0.02, [0xffd9a0, 0.55]],       // .58 .46
    ['terra',      754,  2.785,  -20,  0.48, [0x6ab4ff, 1.05]],       // .51 .55
    ['marte',      807,  3.006,   22,  0.28, [0xe08a5a, 0.32]],       // .43 .51
    ['jupiter',    972,  2.890,   -3,  0.55, null],                   // .36 .59
    ['saturno',   1062,  3.036,   44,  0.50, null],                   // .28 .55
    ['urano',     1185,  2.913,   22, -0.22, [0x9fe8ee, 0.60]],       // .21 .64
    ['netuno',    1286,  3.017,   69,  0.24, [0x5f8dff, 0.62]],       // .14 .59
    ['plutao',    1364,  2.902,   50,  0.10, null],                   // .06 .68
  ];

  /* Amplitude pequena de propósito: o suficiente para o olho ler deriva
     orbital, pouco o bastante para ninguém sair do enquadramento resolvido.
     Com a fileira em contas justas, 0.012 rad é o teto antes de dois vizinhos
     se tocarem no ponto extremo da libração. */
  const LIBRA = 0.012;

  /* Sol na borda DIREITA, no plano, e grande o bastante para dominar o terço
     direito do quadro — o ponto de fuga da composição de referência. */
  const SOL_R = 232;
  const sol = fazSol(SOL_R);
  sol.position.set(900, 0, -120);
  scene.add(sol);
  const solPos = sol.position.clone();
  const SOL_POS = solPos;

  const luzSol = new THREE.PointLight(0xfff2dc, 2.6, 0, 2);
  luzSol.position.copy(solPos);
  scene.add(luzSol);
  scene.add(new THREE.AmbientLight(0x14243a, 0.34));   // preenchimento mínimo, só para o preto não morrer

  const planetas = [];
  CORPOS.forEach(([tipo, orb, fase, alt, giro, atm]) => {
    const raio = R_CORPO;
    const grupo = new THREE.Group();
    const corpo = (tipo === 'terra') ? fazTerra(raio) : fazPlaneta(tipo, raio);
    grupo.add(corpo);

    if (atm) grupo.add(fazAtmosfera(raio * 1.055, atm[0], atm[1]));

    let aneis = null;
    if (tipo === 'saturno') {
      aneis = fazAneis(raio * 1.18, raio * 2.05, raio);
      aneis.rotation.x = Math.PI/2 - 0.52; aneis.rotation.y = 0.30;             // inclinação tridimensional
      grupo.add(aneis);
    }
    if (tipo === 'urano') {
      const a = fazAneis(raio * 1.42, raio * 1.72, raio);
      a.rotation.x = Math.PI / 2; a.rotation.y = 1.35;
      a.material.uniforms.uCentro = { value: new THREE.Vector3() };
      grupo.add(a); aneis = a;
    }
    scene.add(grupo);
    scene.add(fazOrbita(orb, SOL_POS, alt));   // o traço passa pelo corpo, não sob ele
    planetas.push({ tipo, grupo, corpo, aneis, orb, giro, raio, fase, alt,
                    vel:  0.020 + Math.random() * 0.016,     // ritmo da libração
                    flut: 0.11  + Math.random() * 0.13 });
  });



  /* ─── LUA MONUMENTAL, acima de todos os corpos ───
     Fica no alto à esquerda: mais alta que qualquer planeta e no lado oposto ao
     Sol, que ancora o alto à direita. Os dois seguram as pontas do quadro.

     Ela é o ÚNICO corpo que não recebe a luz do Sol. Recebe uma luz própria,
     posta quase atrás da câmera, e por isso aparece como disco CHEIO — branca
     e inteira. Iluminada pelo Sol como os planetas, a Lua mostraria um
     crescente lateral e metade dela sumiria no preto; aqui ela é a contraluz
     fria da composição, e contraluz só cumpre o papel se for vista inteira. */
  const LUA_R = SOL_R * 0.78;                           // ~88% do Sol NA TELA, que é o que se vê
  const lua = fazPlaneta('lua', LUA_R);
  const LUA_POS = new THREE.Vector3(-352, 428, -180);   // canto alto esquerdo, ISOLADA da fileira
  lua.position.copy(LUA_POS);
  scene.add(lua);
  // luz própria da Lua: junto da câmera e um pouco à esquerda, para o disco vir cheio
  const LUZ_LUAR = new THREE.Vector3(-900, 900, 1900);

  // halo frio do luar — painel que encara a câmera, mesma técnica da coroa solar
  const matLuar = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 } },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; uniform float uT;
      void main(){
        vec2 d = vUv*2.0-1.0; float r = length(d);
        if(r > 1.0) discard;
        // núcleo fecha rápido, véu se estende — é o que o olho lê como luar
        // núcleo forte e véu CURTO: o que faz a Lua parecer reluzente é o halo
        // apertado junto ao disco. Véu longo não brilha mais — só levanta o
        // preto do espaço num terço do quadro e achata o contraste todo.
        float nucleo = pow(max(0.0, 1.0 - r/0.36), 2.0);
        float veu    = pow(max(0.0, 1.0 - r), 3.8);
        float a = (nucleo*2.10 + veu*0.80) * (0.94 + 0.06*sin(uT*0.21));
        // branco puro no miolo, esfriando para azul só na franja: é assim que
        // o luar se lê como luz, e não como névoa colorida
        vec3 cor = mix(vec3(0.80,0.88,1.00), vec3(1.00,1.00,1.00), pow(max(0.0,1.0-r),1.2));
        gl_FragColor = vec4(cor, clamp(a,0.0,1.0)*2.30);
      }`,
  });
  const luar = new THREE.Mesh(new THREE.PlaneGeometry(LUA_R * 7.2, LUA_R * 7.2), matLuar);
  luar.position.copy(lua.position);
  luar.onBeforeRender = (r, s, cam) => luar.quaternion.copy(cam.quaternion);
  scene.add(luar);

  // luz de preenchimento fria vinda da Lua: sem ela o lado oposto some no preto
  const luzLua = new THREE.PointLight(0xeaf2ff, 1.45, 0, 2);
  luzLua.position.copy(lua.position);
  scene.add(luzLua);

  /* ═══════════════ METEOROS ═══════════════
     Rocha irregular + rastro. Duas decisões que fazem a diferença:

     1) A rocha é um icosaedro DEFORMADO, não uma esfera. Meteoro é fragmento:
        esfera lisa em miniatura lê como bolinha. O deslocamento é função da
        direção do vértice, então vértices coincidentes (a geometria é não
        indexada) recebem o mesmo empurrão e a casca não se rasga.

     2) O rastro é um billboard ESTICADO — gira em torno do próprio eixo de voo
        para sempre encarar a câmera. Um quad de orientação fixa vira uma tira
        de papel de perfil quando o meteoro voa na direção do observador; este
        mantém a espessura em qualquer ângulo.

     Eles nascem e reaparecem dentro do TRONCO DE VISÃO, não numa caixa de
     mundo. Uma caixa fixa parece razoável e não é: como o tronco se abre com a
     distância e ainda muda de forma a cada resize, a maior parte dos meteoros
     acaba fora do quadro — na primeira medição só 1 de 38 aparecia. Sorteando
     em (x_tela, y_tela, profundidade) a densidade na tela é o que se controla,
     que é justamente o que importa. */
  const NDC_BORDA = 1.28;                 // margem além do quadro: entram e saem
  const PROF = [340, 2300];               // faixa de profundidade à frente da câmera
  const FLUXO = new THREE.Vector3(-0.80, -0.30, 0.52).normalize();  // direção dominante

  const matRastro = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uCor: { value: new THREE.Color(0xffd7a8) }, uInt: { value: 1 } },
    vertexShader: `varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; uniform vec3 uCor; uniform float uInt;
      void main(){
        // vUv.x: 0 na cabeça, 1 na ponta da cauda
        float larg = mix(1.0, 0.10, pow(vUv.x, 0.65));      // a cauda afina
        float d = abs(vUv.y*2.0 - 1.0);
        float perfil = 1.0 - smoothstep(larg*0.30, larg, d);
        float aten = pow(max(0.0, 1.0 - vUv.x), 2.0);
        // o miolo do rastro queima para branco; a franja guarda a cor
        vec3 cor = mix(uCor, vec3(1.0), pow(perfil, 2.4)*0.85);
        gl_FragColor = vec4(cor, perfil*aten*uInt);
      }`,
  });

  function fazRocha(raio) {
    const g = new THREE.IcosahedronGeometry(raio, 2);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = v.clone().normalize();
      // ruído determinístico pela DIREÇÃO: vértices duplicados casam
      const d = Math.sin(n.x*7.3 + n.y*4.1) * Math.cos(n.z*5.7 - n.x*3.3)
              + 0.5*Math.sin(n.y*11.9 + n.z*8.2);
      v.multiplyScalar(1 + d * 0.19);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  function fazMeteoro() {
    const raio = 8;                       // base: a escala aparente manda no resto
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uGiro: { value: Math.random()*6.28 },
                  uSol: { value: new THREE.Vector3() },
                  uDir: { value: new THREE.Vector3(1,0,0) } },
      vertexShader: VERT,
      fragmentShader: `
        precision highp float;
        varying vec3 vN; varying vec3 vP; varying vec3 vL;
        uniform float uT; uniform vec3 uSol; uniform vec3 uDir;
        ${RUIDO}
        void main(){
          float m = fbm(vL*5.5, 5), cr = fbm(vL*18.0, 3);
          vec3 cor = mix(vec3(0.40,0.36,0.33), vec3(0.17,0.15,0.14), m);
          cor *= 0.80 + 0.40*cr;
          vec3 N = normalize(vN);
          float luz = smoothstep(-0.20, 0.36, dot(N, normalize(uSol - vP)));
          // ablação: a face que ataca o vácuo esquenta e brilha
          float ataque = pow(max(0.0, dot(N, normalize(uDir))), 2.6);
          vec3 fin = cor*(luz*1.10 + 0.10) + vec3(1.00,0.58,0.24)*ataque*0.95;
          gl_FragColor = vec4(fin, 1.0);
        }`,
    });
    const rocha = new THREE.Mesh(fazRocha(raio), mat);
    const rastro = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), matRastro.clone());
    rastro.matrixAutoUpdate = false;
    rastro.frustumCulled = false;
    // tom por meteoro: os rápidos puxam para o branco-azulado, os lentos para o âmbar
    // ~20 a 60 s para cruzar o quadro: sobrevoo, não chuva de meteoros. Rápido
    // demais e o pano de fundo rouba a atenção da malha de nós, que é o assunto.
    const vel = 32 + Math.random() * 128;
    rastro.material.uniforms.uCor.value.setHSL(0.10 - (vel/160)*0.062, 0.85, 0.62);
    rastro.material.uniforms.uInt.value = 0.42 + Math.random()*0.38;
    scene.add(rocha); scene.add(rastro);
    return {
      rocha, rastro, mat, raio, vel,
      pos: new THREE.Vector3(),
      /* Direção quase livre, com viés fraco no fluxo. Um viés forte alinhava
         todos os rastros e a cena virava chuva riscando a tela em paralelo —
         meteoro é corpo em órbita própria, cada um vem do seu lado. */
      dir: FLUXO.clone().multiplyScalar(0.35).add(new THREE.Vector3(
        Math.random()-0.5, Math.random()-0.5, Math.random()-0.5)).normalize(),
      giro: 0.4 + Math.random() * 1.4,
      /* Tamanho ANGULAR alvo, em fração da altura da tela. Com raio físico fixo
         os que passam perto ficavam maiores que Mercúrio; fixando o ângulo e
         deixando a escala seguir a distância, um meteoro parece um meteoro em
         qualquer profundidade. */
      alvoAng: 0.0045 + Math.random() * 0.0065,
      comp: 0,
    };
  }

  /* (x_tela, y_tela, profundidade) → mundo, usando a base da própria câmera.
     Vale para qualquer fov/aspecto, então continua correto depois de um resize. */
  const _cF = new THREE.Vector3(), _cR = new THREE.Vector3(), _cU = new THREE.Vector3();
  function daTela(nx, ny, prof, destino) {
    _cF.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _cR.set(1, 0,  0).applyQuaternion(camera.quaternion);
    _cU.set(0, 1,  0).applyQuaternion(camera.quaternion);
    const meiaAlt = Math.tan(camera.fov * Math.PI / 360) * prof;
    return destino.copy(camera.position)
      .addScaledVector(_cF, prof)
      .addScaledVector(_cR, nx * meiaAlt * camera.aspect)
      .addScaledVector(_cU, ny * meiaAlt);
  }

  const meteoros = Array.from({ length: 11 }, fazMeteoro);
  meteoros.forEach(m => {
    daTela((Math.random()*2-1) * NDC_BORDA, (Math.random()*2-1) * NDC_BORDA,
           PROF[0] + Math.random() * (PROF[1] - PROF[0]), m.pos);
  });

  /* Casa a escala com a distância para o tamanho na tela ficar constante, e
     dimensiona o rastro a partir do raio JÁ escalado — senão a cauda cresce
     com a profundidade enquanto a rocha encolhe. */
  function escalaMeteoro(m) {
    const prof = camera.position.distanceTo(m.pos);
    const meiaAlt = Math.tan(camera.fov * Math.PI / 360) * prof;
    const s = (m.alvoAng * 2 * meiaAlt) / m.raio;
    m.rocha.scale.setScalar(s);
    m.comp = m.raio * s * (9 + m.vel * 0.145);
    m.larg = m.raio * s * 1.7;
  }

  /* Saiu pela direita, volta pela esquerda — em coordenadas de TELA. Reentra
     rente à borda oposta, com as outras coordenadas sorteadas de novo para não
     repetir sempre a mesma trilha. */
  const _ndc = new THREE.Vector3();
  function reciclaMeteoro(m) {
    _ndc.copy(m.pos).project(camera);
    const prof = camera.position.distanceTo(m.pos);
    const sorteia = () => (Math.random()*2-1) * NDC_BORDA;
    if (_ndc.z < -1 || _ndc.z > 1 || prof < PROF[0] || prof > PROF[1])
      daTela(sorteia(), sorteia(), PROF[0] + Math.random()*(PROF[1]-PROF[0]), m.pos);
    else if (Math.abs(_ndc.x) > NDC_BORDA)
      daTela(-Math.sign(_ndc.x) * NDC_BORDA, sorteia(),
             PROF[0] + Math.random()*(PROF[1]-PROF[0]), m.pos);
    else if (Math.abs(_ndc.y) > NDC_BORDA)
      daTela(sorteia(), -Math.sign(_ndc.y) * NDC_BORDA,
             PROF[0] + Math.random()*(PROF[1]-PROF[0]), m.pos);
  }

  const _eX = new THREE.Vector3(), _eY = new THREE.Vector3(), _eZ = new THREE.Vector3(),
        _aoCam = new THREE.Vector3(), _cen = new THREE.Vector3();
  function orientaRastro(m, cam) {
    _eX.copy(m.dir).negate();                       // o rastro se estende para TRÁS
    _aoCam.copy(cam.position).sub(m.pos).normalize();
    _eY.crossVectors(_eX, _aoCam);
    if (_eY.lengthSq() < 1e-8) _eY.set(0, 1, 0);    // voando direto na câmera
    _eY.normalize();
    _eZ.crossVectors(_eX, _eY).normalize();
    m.rastro.matrix.makeBasis(_eX.clone().multiplyScalar(m.comp),
                              _eY.clone().multiplyScalar(m.larg), _eZ);
    // o quad é centrado: desloca meio comprimento para a cabeça nascer na rocha
    _cen.copy(m.pos).addScaledVector(_eX, m.comp * 0.5);
    m.rastro.matrix.setPosition(_cen);
    m.rastro.matrixWorldNeedsUpdate = true;
  }

  scene.add(fazEstrelas(2600, 900, 1.5, 0.85));
  scene.add(fazEstrelas(1800, 1500, 2.4, 0.65));
  scene.add(fazEstrelas(1200, 2400, 3.6, 0.42));
  scene.add(fazEstrelas(3200, 3200, 6.0, 0.48));   // domo de fundo: céu POVOADO até o far

  /* ─────────────── laço ─────────────── */
  let W = 0, H = 0, t0 = performance.now(), pausado = false;
  function redimensiona() {
    W = innerWidth; H = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.75);   // teto: acima disso o ganho não paga
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // enquadramento panorâmico: a cena tem de caber na largura, não na altura
    camera.fov = W / H < 1.5 ? 54 : 46;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', redimensiona);
  redimensiona();

  /* LUZ COM TETO DE CONTRALUZ. Mercúrio e Vênus vivem colados no Sol na tela;
     com a luz física ficariam a 125–146° de fase — discos quase pretos. Todo
     pôster de sistema solar comete a mesma mentira piedosa: se a fase passa de
     85°, a luz desliza (no plano Sol–câmera–corpo) até os 85° — pouco mais de
     meio disco iluminado, terminador cortando o corpo. Quem está longe do Sol
     na tela segue com a iluminação física intocada. */
  const COS_MAX = Math.cos(85 * Math.PI / 180), SIN_MAX = Math.sin(85 * Math.PI / 180);
  const _pCam = new THREE.Vector3(), _pSol = new THREE.Vector3(),
        _perpL = new THREE.Vector3(), _luzV = new THREE.Vector3();
  function luzDoCorpo(p) {
    _pCam.copy(camera.position).sub(p.grupo.position).normalize();
    _pSol.copy(solPos).sub(p.grupo.position);
    const dSol = _pSol.length(); _pSol.divideScalar(dSol);
    const c = _pSol.dot(_pCam);
    if (c >= COS_MAX) return _luzV.copy(solPos);            // fase ≤ 85°: Sol real
    _perpL.copy(_pSol).addScaledVector(_pCam, -c);
    if (_perpL.lengthSq() < 1e-6) _perpL.copy(camera.up);   // Sol exatamente atrás
    _perpL.normalize();
    return _luzV.copy(_pCam).multiplyScalar(COS_MAX).addScaledVector(_perpL, SIN_MAX)
                .multiplyScalar(dSol).add(p.grupo.position);
  }

  let tAnt = 0;
  function quadro() {
    requestAnimationFrame(quadro);
    if (pausado) return;
    const t = (performance.now() - t0) / 1000;
    // teto no passo: se a aba ficou em segundo plano, um dt gigante teleporta
    // todos os meteoros de uma vez e a circulação se desfaz
    const dt = Math.min(t - tAnt, 0.1); tAnt = t;

    sol.userData.matS.uniforms.uT.value = t;
    sol.userData.matS.uniforms.uGiro.value = t * 0.018;
    for (const c of sol.userData.coroas) c.uniforms.uT.value = t;

    for (const p of planetas) {
      // libração: desliza sobre a própria órbita, sempre dentro do quadro.
      // Períodos longos e primos entre si — nada anda em bloco.
      const a = p.fase + Math.sin(t * p.vel) * LIBRA;
      const flutY = Math.sin(t*p.flut + p.fase)*11 + Math.sin(t*p.flut*0.41 + p.fase*2.0)*6;
      p.grupo.position.set(SOL_POS.x + Math.cos(a) * p.orb,
                           SOL_POS.y + p.alt + flutY,
                           SOL_POS.z + Math.sin(a) * p.orb);
      const mats = p.tipo === 'terra'
        ? [p.corpo.userData.matSolo, p.corpo.userData.matNuvem]
        : [p.corpo.userData.mat];
      const luz = luzDoCorpo(p);
      mats.forEach((m, i) => {
        m.uniforms.uT.value = t;
        m.uniforms.uGiro.value = t * p.giro * (i === 1 ? 1.35 : 1);   // nuvem corre mais que o solo
        m.uniforms.uSol.value.copy(luz);
      });
      p.grupo.children.forEach(ch => {
        const u = ch.material && ch.material.uniforms;
        if (u && u.uSol) u.uSol.value.copy(luz);
        if (u && u.uCentro) u.uCentro.value.copy(p.grupo.position);
      });
    }

    // LUA: gira devagar e flutua no lugar; o halo acompanha
    lua.position.y = LUA_POS.y + Math.sin(t * 0.13) * 14;
    lua.userData.mat.uniforms.uT.value = t;
    lua.userData.mat.uniforms.uGiro.value = t * 0.012;
    lua.userData.mat.uniforms.uSol.value.copy(LUZ_LUAR);   // luz própria, não a do Sol
    luar.position.copy(lua.position);
    matLuar.uniforms.uT.value = t;
    luzLua.position.copy(lua.position);

    // METEOROS: avançam, giram e reaparecem na face oposta da caixa
    for (const m of meteoros) {
      m.pos.addScaledVector(m.dir, m.vel * dt);
      reciclaMeteoro(m);
      escalaMeteoro(m);
      m.rocha.position.copy(m.pos);
      m.mat.uniforms.uT.value = t;
      m.mat.uniforms.uGiro.value = t * m.giro;
      m.mat.uniforms.uSol.value.copy(solPos);
      m.mat.uniforms.uDir.value.copy(m.dir);
      orientaRastro(m, camera);
    }

    renderer.render(scene, camera);
  }
  quadro();

  /* NÃO pausar por prefers-reduced-motion. Windows com "efeitos de animação"
     desligados faz o navegador declarar reduce — e foi isso que congelou Sol,
     planetas e meteoros na máquina do operador: ele via uma FOTO e pedia vida.
     O painel é cinematográfico por decisão explícita; quem quiser estático tem
     o interruptor: ELXCosmos.pausar(true). */

  window.ELXCosmos = {
    get pausado() { return pausado; },
    pausar(v) { pausado = v !== undefined ? !!v : !pausado; if (!pausado) quadro(); },
    cena: scene, camera, renderer,
    /* Enquadramento é decisão visual, e decisão visual se AFERE, não se estima.
       Devolve, por corpo, a posição em coordenadas de tela (0..1) e o raio em
       fração da largura — é com isso que se verifica "nenhum planeta escondido"
       sem depender de olhar para o print. */
    projeta(x, y, z, r) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const d = camera.position.distanceTo(new THREE.Vector3(x, y, z));
      const meiaAlt = Math.tan(camera.fov * Math.PI / 360) * d;
      // zn fora de [-1,1] = ponto atrás da câmera ou além do far: a projeção
      // ainda devolve um x/y de aparência plausível, e é assim que se compõe
      // uma cena com um corpo que não existe no quadro.
      return { x: +((v.x + 1) / 2).toFixed(3), y: +((1 - v.y) / 2).toFixed(3),
               raioTela: +((r || 62) / meiaAlt / 2).toFixed(3),
               dist: Math.round(d), zn: +v.z.toFixed(3) };
    },
    meteoros: () => meteoros.map(m => ({ x:m.pos.x, y:m.pos.y, z:m.pos.z, raio:m.raio })),
    planetasDebug: () => planetas.map(p => ({ tipo: p.tipo, pos: p.grupo.position.clone(),
      uSol: (p.tipo === 'terra' ? p.corpo.userData.matSolo : p.corpo.userData.mat).uniforms.uSol.value.clone() })),
    enquadramento() {
      const v = new THREE.Vector3();
      const alvo = [...planetas.map(p => ({ nome: p.tipo, obj: p.grupo, r: p.raio })),
                    { nome: 'sol', obj: sol, r: SOL_R }, { nome: 'lua', obj: lua, r: LUA_R }];
      return alvo.map(({ nome, obj, r }) => {
        v.copy(obj.position).project(camera);
        const d = camera.position.distanceTo(obj.position);
        const meiaAlt = Math.tan(camera.fov * Math.PI / 360) * d;
        return { nome,
                 x: +((v.x + 1) / 2).toFixed(3), y: +((1 - v.y) / 2).toFixed(3),
                 raioTela: +(r / meiaAlt / 2).toFixed(3),   // fração da ALTURA da tela
                 dist: Math.round(d) };
      });
    },
  };
})();
