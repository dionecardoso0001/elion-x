/* ═══════════════════════════════════════════════════════════════════════
   ELION-X // SENTINELA — configuração central

   Fonte única de verdade para três coisas que não podem divergir entre
   o navegador e o servidor: os MODELOS (endereço + impressão digital
   SHA-256), a versão do runtime de visão e os LIMIARES de decisão.

   Cada limiar declara a procedência em docs/SENTINELA.md, em uma de
   três categorias — e a diferença importa, porque é ela que diz o quanto
   confiar num alarme:
     · NORMA/LITERATURA  — número verificado em fonte primária
     · DERIVADO          — conta explícita a partir de um número verificado
     · HEURÍSTICA        — ponto de partida de engenharia, exige calibração
                           em campo antes de uso operacional
   Este arquivo é ESM puro (sem DOM): o script de download de modelos e
   os testes em Node importam daqui.
   ═══════════════════════════════════════════════════════════════════════ */

export const VERSAO = '1.0.0';

/* Runtime de visão. Servido pela PRÓPRIA origem (dependência npm fixada)
   e, só se ela faltar, pelo CDN — na mesma versão exata. Versão fixada
   e não "latest": um runtime que muda sozinho muda o comportamento dos
   alarmes sem ninguém ter revisado. */
export const MEDIAPIPE_VERSAO = '1.1.1';
export const MEDIAPIPE_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSAO}`;

/* Modelos (Google MediaPipe, caminhos versionados "/1/").
   O SHA-256 foi medido sobre o arquivo baixado da origem oficial. Um
   modelo adulterado decide quem é "pessoa" e o que é "olho fechado" —
   num sistema que dispara alarme no trânsito isso é superfície de
   ataque, não detalhe. Divergiu a impressão digital, o modelo é recusado. */
export const MODELOS = {
  objetos: {
    nome: 'EfficientDet-Lite0 (COCO, float16)',
    arquivo: 'efficientdet_lite0.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
    sha256: '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993',
    bytes: 7254339,
  },
  rosto: {
    nome: 'Face Landmarker (478 pontos + blendshapes)',
    arquivo: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    bytes: 3758596,
  },
  pose: {
    nome: 'Pose Landmarker Lite (33 pontos)',
    arquivo: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    bytes: 5777746,
  },
};

/* Quais modelos cada modo precisa. O detector de objetos entra no modo
   motorista para um único fim: flagrar o CELULAR na mão do condutor. */
export const MODELOS_POR_MODO = {
  sentinela: ['objetos', 'pose'],
  motorista: ['rosto', 'objetos'],
  transito:  ['objetos'],
};

/* Rótulos do detector — extraídos do labels.txt embutido no próprio
   .tflite (90 índices COCO, 80 classes válidas). Tradução para o HUD. */
export const ROTULOS = {
  person: 'PESSOA', bicycle: 'BICICLETA', car: 'CARRO', motorcycle: 'MOTO',
  airplane: 'AVIÃO', bus: 'ÔNIBUS', train: 'TREM', truck: 'CAMINHÃO', boat: 'BARCO',
  'traffic light': 'SEMÁFORO', 'fire hydrant': 'HIDRANTE', 'stop sign': 'PLACA PARE',
  'parking meter': 'PARQUÍMETRO', bench: 'BANCO', bird: 'AVE', cat: 'GATO', dog: 'CÃO',
  horse: 'CAVALO', sheep: 'OVELHA', cow: 'VACA', elephant: 'ELEFANTE', bear: 'URSO',
  zebra: 'ZEBRA', giraffe: 'GIRAFA', backpack: 'MOCHILA', umbrella: 'GUARDA-CHUVA',
  handbag: 'BOLSA', tie: 'GRAVATA', suitcase: 'MALA', frisbee: 'FRISBEE', skis: 'ESQUI',
  snowboard: 'SNOWBOARD', 'sports ball': 'BOLA', kite: 'PIPA', 'baseball bat': 'TACO',
  'baseball glove': 'LUVA', skateboard: 'SKATE', surfboard: 'PRANCHA',
  'tennis racket': 'RAQUETE', bottle: 'GARRAFA', 'wine glass': 'TAÇA', cup: 'COPO',
  fork: 'GARFO', knife: 'FACA', spoon: 'COLHER', bowl: 'TIGELA', banana: 'BANANA',
  apple: 'MAÇÃ', sandwich: 'SANDUÍCHE', orange: 'LARANJA', broccoli: 'BRÓCOLIS',
  carrot: 'CENOURA', 'hot dog': 'CACHORRO-QUENTE', pizza: 'PIZZA', donut: 'ROSQUINHA',
  cake: 'BOLO', chair: 'CADEIRA', couch: 'SOFÁ', 'potted plant': 'VASO',
  bed: 'CAMA', 'dining table': 'MESA', toilet: 'VASO SANITÁRIO', tv: 'TV',
  laptop: 'NOTEBOOK', mouse: 'MOUSE', remote: 'CONTROLE', keyboard: 'TECLADO',
  'cell phone': 'CELULAR', microwave: 'MICRO-ONDAS', oven: 'FORNO', toaster: 'TORRADEIRA',
  sink: 'PIA', refrigerator: 'GELADEIRA', book: 'LIVRO', clock: 'RELÓGIO', vase: 'JARRO',
  scissors: 'TESOURA', 'teddy bear': 'PELÚCIA', 'hair drier': 'SECADOR', toothbrush: 'ESCOVA',
};
export const rotulo = c => ROTULOS[c] || String(c || '?').toUpperCase();

/* Famílias de classe usadas pelos analisadores. */
export const CLASSES = {
  // objetos portáteis que uma pessoa pode esquecer ou abandonar
  portateis: ['backpack', 'handbag', 'suitcase', 'umbrella', 'laptop', 'cell phone', 'book'],
  // objetos que merecem atenção imediata numa cena de vigilância.
  // O COCO não tem arma de fogo: "faca" é a de cozinha e erra bastante —
  // por isso a mensagem pede verificação humana, nunca afirma.
  risco: ['knife', 'baseball bat', 'scissors'],
  veiculos: ['car', 'truck', 'bus', 'motorcycle', 'bicycle'],
  animais: ['dog', 'cat', 'horse', 'sheep', 'cow', 'bird', 'elephant', 'bear', 'zebra', 'giraffe'],
  // o que o COCO consegue reconhecer e que pode estar caído numa pista.
  // Buraco, pneu, cone e entulho NÃO existem no COCO — limitação declarada.
  obstaculos: ['suitcase', 'backpack', 'handbag', 'sports ball', 'chair', 'bench',
               'skateboard', 'umbrella', 'bottle', 'potted plant', 'traffic light', 'stop sign'],
};

/* Dimensões físicas típicas (m) para o modelo de câmera pinhole do modo
   trânsito: Z = f · W_real / w_imagem. São médias de projeto, não
   medições do veículo à frente — a distância exibida é "~" de propósito. */
export const DIMENSOES = {
  car: { largura: 1.8 }, truck: { largura: 2.5 }, bus: { largura: 2.55 },
  motorcycle: { largura: 0.8 }, bicycle: { largura: 0.6 },
  person: { altura: 1.7 }, dog: { altura: 0.6 }, cow: { altura: 1.4 }, horse: { altura: 1.6 },
  sheep: { altura: 0.9 }, cat: { altura: 0.3 }, bird: { altura: 0.3 },
};

export const LIMIARES = {
  deteccao: {
    scoreMin: 0.42,              // HEURÍSTICA — abaixo disso o Lite0 alucina demais em cena real
    scoreNovaTrilha: 0.5,        // HEURÍSTICA — exige mais para NASCER um alvo do que para mantê-lo
  },

  motorista: {
    calibracaoMs: 5000,          // janela de linha de base: postura neutra e olho aberto do condutor
    fechadoP80: 0.8,             // NORMA — PERCLOS P80: olho ≥ 80% fechado conta como fechado
    perclosJanelaMs: 60000,      // NORMA — PERCLOS é a proporção de tempo, em 1 minuto, com olho ≥80% fechado
    perclosCoberturaMinMs: 30000,// não acusa fadiga com menos de 30 s de rosto observado
    perclosAviso: 0.08,          // LITERATURA — faixa histórica validada 8–12% (janelas de 1–3 min)
    perclosCritico: 0.12,        //   idem, topo da faixa
    microssonoS: 1.0,            // HEURÍSTICA — piscada normal dura frações de segundo; 1 s fechado é anormal
    bocejoJawOpen: 0.55,         // HEURÍSTICA — blendshape jawOpen sustentado = boca escancarada
    bocejoMinS: 1.2,             // HEURÍSTICA — fala e riso abrem a boca por menos tempo
    bocejosAviso: 3,             // HEURÍSTICA — bocejos em 5 min
    distracaoYawGraus: 30,       // HEURÍSTICA — cabeça girada além disso tira a via do campo central
    distracaoPitchGraus: 20,     // HEURÍSTICA — cabeça baixa (colo / celular)
    distracaoAvisoS: 2.0,        // HEURÍSTICA
    distracaoCriticoS: 4.0,      // HEURÍSTICA
    pendendoPitchGraus: 20,      // HEURÍSTICA — cabeça cai com olho fechado = cochilo
    malSubitoRollGraus: 30,      // HEURÍSTICA — cabeça tombada para o lado e parada
    malSubitoPitchGraus: 35,     // HEURÍSTICA — cabeça caída para a frente e parada
    malSubitoS: 2.5,
    ausenteS: 3.0,               // HEURÍSTICA — rosto sumiu depois de estar presente
    celularMinS: 1.0,
    instabilidadeJanelaMs: 5000, // EXPERIMENTAL — oscilação da cabeça (proxy de tontura)
    instabilidadeRollStd: 6,
    instabilidadeYawStd: 8,
    instabilidadeReversoes: 6,
    velocidadeMinimaMs: 2.8,     // ~10 km/h — abaixo disso, com GPS, o carro é tratado como parado
  },

  transito: {
    fovHorizontalGraus: 70,      // HEURÍSTICA — câmera principal típica de celular; ajustável na tela
    ttcJanelaMs: 900,            // regressão de ln(largura) sobre ~0,9 s de histórico
    ttcAmostrasMin: 5,
    ttcR2Min: 0.35,
    ttcCriticoS: 2.6,            // DERIVADO — NHTSA exige alerta de colisão até TTC 2,1 s (veículo parado);
                                 //            +0,5 s de margem para a latência deste pipeline
    ttcAvisoS: 4.0,              // HEURÍSTICA — pré-alerta
    distanciaMaxAlvoM: 70,       // acima disso a estimativa monocular é ruído
    headwayAvisoS: 1.0,          // HEURÍSTICA — referência prática usual de direção defensiva é ≥ 2 s
    aproximacaoMs: 2.0,          // m/s de fechamento que caracteriza "distância encurtando" sem GPS
    distanciaCurtaM: 25,
    pedestreCriticoM: 25,
    lateralPedestre: 0.06,       // velocidade lateral (fração do quadro/s) rumo ao corredor
    roi: { topoY: 0.55, baseY: 0.98, larguraTopo: 0.16, larguraBase: 0.92, centroX: 0.5 },
  },

  vigilancia: {
    intrusaoMinS: 0.6,           // debounce: um quadro dentro da zona não é invasão
    permanenciaS: 45,            // HEURÍSTICA — permanência em zona monitorada
    estaticoJanelaMs: 2500,
    estaticoDesloc: 0.012,       // fração da diagonal do quadro
    abandonoS: 30,               // LITERATURA (PETS 2006, citado como 3 m / 30 s — não confirmado na fonte primária)
    raioDonoM: 3,                //   idem
    alturaPessoaM: 1.7,          // escala: converte "alturas de pessoa" em metros
    remocaoEstaticoMinS: 10,     // só acusa retirada de objeto que estava parado há ≥ 10 s
    corridaAlturasS: 1.6,        // HEURÍSTICA — ~2,7 m/s para 1,7 m de altura
    corridaMinS: 0.7,
    quedaTorsoGraus: 60,
    quedaRazaoMax: 1.0,          // altura/largura física da caixa: em pé ≈ 2,5–3,5; deitado < 1
    quedaJanelaMs: 2000,         // precisava estar em pé há no máximo 2 s → queda é transição BRUSCA
    quedaMinS: 1.5,
    maosAltoS: 2.0,
    aglomeracao: 6,
    riscoHitsMin: 4,
  },

  anomalia: {
    grade: [12, 9],
    aquecimentoAmostras: 400,    // não acusa nada antes de conhecer a cena
    probRara: 0.002,
    zVelocidade: 3.5,
    esquecimentoPorMin: 0.97,
  },

  alertas: {
    histereseMs: 2500,           // condição só "acaba" após 2,5 s ausente — evita sirene piscando
    repetirVozCriticoMs: 7000,
    cooldownMs: { critico: 10000, aviso: 20000, info: 30000 },
    silenciarMs: 30000,
  },

  agente: {
    intervaloResumoMs: 15000,
    intervaloAutoMs: 45000,      // custo: no máximo 1 análise profunda automática a cada 45 s
    larguraQuadro: 768,          // ~0,4 MP: suficiente para cena, barato em tokens
    qualidadeJpeg: 0.72,
  },
};

/* Presets de demonstração: os tempos de norma (30 s de abandono) tornam
   um teste em casa entediante. O preset é rotulado na tela para ninguém
   confundir demonstração com operação. */
export const PRESET_DEMO = {
  vigilancia: { abandonoS: 8, permanenciaS: 12, remocaoEstaticoMinS: 4 },
};
