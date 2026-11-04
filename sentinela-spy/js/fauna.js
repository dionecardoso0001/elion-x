/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — fauna na pista (ESM puro, sem DOM)

   O detector de objetos (EfficientDet, COCO) conhece só 10 animais:
   cão, gato, cavalo, ovelha, vaca, ave, elefante, urso, zebra, girafa.
   COBRA não existe no COCO; VEADO não existe nem no COCO nem no ImageNet.

   Por isso há um SEGUNDO estágio — classificador EfficientNet-Lite0 com as
   1.000 classes do ImageNet — em dois usos:
     1. REFINO: o recorte de cada animal que o detector achou é classificado
        ("ave" → GALINHA; "vaca" → BOI/VACA; cão de qualquer porte, 118 raças).
     2. VARREDURA: ladrilhos do corredor do veículo são classificados em
        rodízio, para achar o que o detector não propõe (cobra, tatu, jabuti).
        Exige DUAS leituras seguidas do mesmo ladrilho acima do limiar —
        rachadura, piche e pneu no asfalto enganam um classificador sozinho.

   Os rótulos abaixo foram extraídos do labels_without_background.txt
   embutido no próprio .tflite (1.000 linhas). VEADO entra como "provável"
   pelas classes de antílope (impala, gazela, hartebeest), que são o que o
   ImageNet tem de mais próximo — o laboratório de modelo (fotos suas)
   é o caminho para um veado de verdade. "crane" fica de fora: no ImageNet
   o mesmo nome é a AVE (grou) e o GUINDASTE, e o classificador devolve
   só o nome.

   PORTE decide o nível: animal grande no corredor é crítico (colisão);
   animal pequeno é aviso — desviar bruscamente de animal pequeno causa
   mais acidente do que o próprio animal.
   ═══════════════════════════════════════════════════════════════════════ */

export const CATEGORIAS = {
  cao:        { nome: 'CÃO', fala: 'cachorro', porte: 'grande' },     // porte variável — tratado como risco de colisão
  canideo:    { nome: 'CANÍDEO SILVESTRE', fala: 'animal silvestre', porte: 'grande' },
  felino:     { nome: 'FELINO GRANDE (onça?)', fala: 'felino grande', porte: 'grande' },
  gato:       { nome: 'GATO', fala: 'gato', porte: 'pequeno' },
  bovino:     { nome: 'BOI/VACA', fala: 'boi', porte: 'grande' },
  equino:     { nome: 'CAVALO/MULA', fala: 'cavalo', porte: 'grande' },
  suino:      { nome: 'PORCO/JAVALI', fala: 'porco', porte: 'grande' },
  ovino:      { nome: 'OVELHA/CABRA', fala: 'ovelha ou cabra', porte: 'grande' },
  cervideo:   { nome: 'VEADO/CERVÍDEO (provável)', fala: 'veado', porte: 'grande' },
  camelideo:  { nome: 'LHAMA/CAMELÍDEO', fala: 'animal de grande porte', porte: 'grande' },
  jacare:     { nome: 'JACARÉ', fala: 'jacaré', porte: 'grande' },
  ave_grande: { nome: 'AVE GRANDE (ema?)', fala: 'ave de grande porte', porte: 'grande' },
  galinha:    { nome: 'GALINHA/GALO', fala: 'galinha', porte: 'pequeno' },
  ave:        { nome: 'AVE', fala: 'ave', porte: 'pequeno' },
  cobra:      { nome: 'COBRA', fala: 'cobra', porte: 'pequeno' },
  lagarto:    { nome: 'LAGARTO', fala: 'lagarto', porte: 'pequeno' },
  quelonio:   { nome: 'JABUTI/TARTARUGA', fala: 'jabuti', porte: 'pequeno' },
  tatu:       { nome: 'TATU', fala: 'tatu', porte: 'pequeno' },
  roedor:     { nome: 'ROEDOR/COELHO', fala: 'animal pequeno', porte: 'pequeno' },
  mustelideo: { nome: 'MAMÍFERO PEQUENO', fala: 'animal pequeno', porte: 'pequeno' },
  primata:    { nome: 'MACACO', fala: 'macaco', porte: 'pequeno' },
  preguica:   { nome: 'BICHO-PREGUIÇA', fala: 'bicho-preguiça', porte: 'pequeno' },
};

const CAES = ['Chihuahua', 'Japanese spaniel', 'Maltese dog', 'Pekinese', 'Shih-Tzu', 'Blenheim spaniel', 'papillon', 'toy terrier',
  'Rhodesian ridgeback', 'Afghan hound', 'basset', 'beagle', 'bloodhound', 'bluetick', 'black-and-tan coonhound', 'Walker hound',
  'English foxhound', 'redbone', 'borzoi', 'Irish wolfhound', 'Italian greyhound', 'whippet', 'Ibizan hound', 'Norwegian elkhound',
  'otterhound', 'Saluki', 'Scottish deerhound', 'Weimaraner', 'Staffordshire bullterrier', 'American Staffordshire terrier',
  'Bedlington terrier', 'Border terrier', 'Kerry blue terrier', 'Irish terrier', 'Norfolk terrier', 'Norwich terrier',
  'Yorkshire terrier', 'wire-haired fox terrier', 'Lakeland terrier', 'Sealyham terrier', 'Airedale', 'cairn', 'Australian terrier',
  'Dandie Dinmont', 'Boston bull', 'miniature schnauzer', 'giant schnauzer', 'standard schnauzer', 'Scotch terrier', 'Tibetan terrier',
  'silky terrier', 'soft-coated wheaten terrier', 'West Highland white terrier', 'Lhasa', 'flat-coated retriever',
  'curly-coated retriever', 'golden retriever', 'Labrador retriever', 'Chesapeake Bay retriever', 'German short-haired pointer',
  'vizsla', 'English setter', 'Irish setter', 'Gordon setter', 'Brittany spaniel', 'clumber', 'English springer',
  'Welsh springer spaniel', 'cocker spaniel', 'Sussex spaniel', 'Irish water spaniel', 'kuvasz', 'schipperke', 'groenendael',
  'malinois', 'briard', 'kelpie', 'komondor', 'Old English sheepdog', 'Shetland sheepdog', 'collie', 'Border collie',
  'Bouvier des Flandres', 'Rottweiler', 'German shepherd', 'Doberman', 'miniature pinscher', 'Greater Swiss Mountain dog',
  'Bernese mountain dog', 'Appenzeller', 'EntleBucher', 'boxer', 'bull mastiff', 'Tibetan mastiff', 'French bulldog', 'Great Dane',
  'Saint Bernard', 'Eskimo dog', 'malamute', 'Siberian husky', 'dalmatian', 'affenpinscher', 'basenji', 'pug', 'Leonberg',
  'Newfoundland', 'Great Pyrenees', 'Samoyed', 'Pomeranian', 'chow', 'keeshond', 'Brabancon griffon', 'Pembroke', 'Cardigan',
  'toy poodle', 'miniature poodle', 'standard poodle', 'Mexican hairless'];
const AVES = ['brambling', 'goldfinch', 'house finch', 'junco', 'indigo bunting', 'robin', 'bulbul', 'jay', 'magpie', 'chickadee',
  'water ouzel', 'kite', 'bald eagle', 'vulture', 'great grey owl', 'black grouse', 'ptarmigan', 'ruffed grouse', 'prairie chicken',
  'peacock', 'quail', 'partridge', 'African grey', 'macaw', 'sulphur-crested cockatoo', 'lorikeet', 'coucal', 'bee eater', 'hornbill',
  'hummingbird', 'jacamar', 'toucan', 'drake', 'red-breasted merganser', 'goose', 'black swan', 'white stork', 'black stork',
  'spoonbill', 'flamingo', 'little blue heron', 'American egret', 'bittern', 'limpkin', 'European gallinule',
  'American coot', 'bustard', 'ruddy turnstone', 'red-backed sandpiper', 'redshank', 'dowitcher', 'oystercatcher', 'pelican',
  'king penguin', 'albatross'];
const COBRAS = ['thunder snake', 'ringneck snake', 'hognose snake', 'green snake', 'king snake', 'garter snake', 'water snake',
  'vine snake', 'night snake', 'boa constrictor', 'rock python', 'Indian cobra', 'green mamba', 'sea snake', 'horned viper',
  'diamondback', 'sidewinder'];

const grupo = (rotulos, cat) => rotulos.map(r => [r, cat]);
/** Rótulo do ImageNet (como o MediaPipe devolve em categoryName) → categoria. */
export const MAPA_IMAGENET = new Map([
  ...grupo(CAES, 'cao'),
  ...grupo(['timber wolf', 'white wolf', 'red wolf', 'coyote', 'dingo', 'dhole', 'African hunting dog', 'red fox', 'kit fox', 'grey fox'], 'canideo'),
  ...grupo(['cougar', 'jaguar', 'leopard', 'lynx', 'lion', 'tiger', 'cheetah', 'snow leopard'], 'felino'),
  ...grupo(['tabby', 'tiger cat', 'Persian cat', 'Siamese cat', 'Egyptian cat'], 'gato'),
  ...grupo(['ox', 'water buffalo', 'bison'], 'bovino'),
  ...grupo(['sorrel', 'zebra'], 'equino'),
  ...grupo(['hog', 'wild boar', 'warthog'], 'suino'),
  ...grupo(['ram', 'bighorn', 'ibex'], 'ovino'),
  ...grupo(['hartebeest', 'impala', 'gazelle'], 'cervideo'),
  ...grupo(['Arabian camel', 'llama'], 'camelideo'),
  ...grupo(['African crocodile', 'American alligator'], 'jacare'),
  ...grupo(['ostrich'], 'ave_grande'),
  ...grupo(['cock', 'hen'], 'galinha'),
  ...grupo(AVES, 'ave'),
  ...grupo(COBRAS, 'cobra'),
  ...grupo(['banded gecko', 'common iguana', 'American chameleon', 'whiptail', 'agama', 'frilled lizard', 'alligator lizard',
    'Gila monster', 'green lizard', 'African chameleon', 'Komodo dragon'], 'lagarto'),
  ...grupo(['mud turtle', 'terrapin', 'box turtle'], 'quelonio'),
  ...grupo(['armadillo'], 'tatu'),
  ...grupo(['wood rabbit', 'hare', 'Angora', 'hamster', 'porcupine', 'fox squirrel', 'marmot', 'beaver', 'guinea pig'], 'roedor'),
  ...grupo(['weasel', 'mink', 'polecat', 'black-footed ferret', 'otter', 'skunk', 'badger'], 'mustelideo'),
  ...grupo(['orangutan', 'gorilla', 'chimpanzee', 'gibbon', 'siamang', 'guenon', 'patas', 'baboon', 'macaque', 'langur', 'colobus',
    'proboscis monkey', 'marmoset', 'capuchin', 'howler monkey', 'titi', 'spider monkey', 'squirrel monkey'], 'primata'),
  ...grupo(['three-toed sloth'], 'preguica'),
]);

/** Categoria padrão de cada animal do COCO (antes do refino). */
export const CATEGORIA_COCO = {
  dog: 'cao', cat: 'gato', horse: 'equino', sheep: 'ovino', cow: 'bovino', bird: 'ave',
  elephant: 'grande', bear: 'grande', zebra: 'equino', giraffe: 'grande',
};

export const CFG_FAUNA = {
  refinoMin: 0.30,        // soma das probabilidades da categoria para renomear um animal já detectado
  varreduraMin: 0.45,     // ladrilho sem caixa do detector: exige mais
  confirmacoes: 2,        // leituras seguidas do mesmo ladrilho
  janelaMs: 2500,         // as duas leituras precisam estar a até 2,5 s uma da outra
  refinoIntervaloMs: 700, // cada alvo é reclassificado no máximo a cada 0,7 s
};

/**
 * Soma as probabilidades do classificador por categoria (o top-k divide a massa
 * entre raças/espécies vizinhas: "Labrador" 0,3 + "golden" 0,25 = CÃO 0,55).
 * @param {Array<{nome:string, score:number}>} resultados
 * @returns {{categoria:string, score:number}|null}
 */
export function categoriaDe(resultados) {
  const soma = new Map();
  for (const r of resultados || []) {
    const c = MAPA_IMAGENET.get(r.nome);
    if (c) soma.set(c, (soma.get(c) || 0) + r.score);
  }
  let melhor = null;
  for (const [categoria, score] of soma) if (!melhor || score > melhor.score) melhor = { categoria, score };
  return melhor;
}

/** Nome e porte para exibir, combinando a classe do COCO e o refino (quando confiável). */
export function descreverAnimal(classeCoco, refino = null) {
  if (refino && CATEGORIAS[refino.categoria]) return { ...CATEGORIAS[refino.categoria], categoria: refino.categoria, refinado: true, score: refino.score };
  const c = CATEGORIA_COCO[classeCoco];
  if (c && CATEGORIAS[c]) return { ...CATEGORIAS[c], categoria: c, refinado: false };
  return { nome: 'ANIMAL DE GRANDE PORTE', fala: 'animal de grande porte', porte: 'grande', categoria: 'grande', refinado: false };
}

/**
 * Ladrilhos do corredor (trapézio do modo trânsito), aproximadamente QUADRADOS
 * em pixels: 1 no horizonte, 2 no meio, 3 perto do veículo. Coordenadas
 * normalizadas do quadro; `aspecto` = largura/altura.
 */
export function ladrilhosCorredor(roi, aspecto = 16 / 9) {
  const faixas = [
    { y0: roi.topoY - 0.06, alt: 0.18, n: 1 },
    { y0: roi.topoY + 0.08, alt: 0.24, n: 2 },
    { y0: Math.min(roi.baseY, 1) - 0.34, alt: 0.34, n: 3 },
  ];
  const meiaLargura = y => {
    const f = Math.min(1, Math.max(0, (y - roi.topoY) / Math.max(1e-6, roi.baseY - roi.topoY)));
    return (roi.larguraTopo + f * (roi.larguraBase - roi.larguraTopo)) / 2;
  };
  const out = [];
  for (const f of faixas) {
    const y0 = Math.max(0, f.y0), h = Math.min(f.alt, 1 - y0);
    const w = Math.min(1, h / aspecto);                       // quadrado em pixels
    const meia = Math.max(w / 2, meiaLargura(y0 + h / 2));
    const x0 = roi.centroX - meia, x1 = roi.centroX + meia;
    for (let k = 0; k < f.n; k++) {
      const cx = f.n === 1 ? roi.centroX : x0 + ((k + 0.5) * (x1 - x0)) / f.n;
      const x = Math.min(1 - w, Math.max(0, cx - w / 2));
      out.push({ x, y: y0, w, h });
    }
  }
  return out;
}

/**
 * Recorte do trecho DISTANTE do corredor, para uma segunda passada do detector
 * em resolução maior: animal pequeno ou longe (cão pequeno, galinha) ocupa
 * poucos pixels no quadro inteiro e o detector, que reduz tudo a 320×320,
 * perde. É a ideia do SAHI (Akyon et al., 2022, "Slicing Aided Hyper Inference").
 */
export function recorteDistante(roi, aspecto = 16 / 9) {
  const h = 0.36;
  const y = Math.max(0, Math.min(1 - h, roi.topoY - 0.12));
  const w = Math.min(1, Math.max(roi.larguraTopo * 2.2, (h * 1.6) / aspecto));
  const x = Math.max(0, Math.min(1 - w, roi.centroX - w / 2));
  return { x, y, w, h };
}

/**
 * Leva detecções feitas no recorte para coordenadas do quadro e funde com as do
 * quadro inteiro. Duplicata = mesma classe com IoU > 0,5 OU uma caixa quase toda
 * dentro da outra (interseção/menor área > 0,6). Detecção do recorte que encosta
 * na borda dele está CORTADA (o animal continua fora do recorte): perde a
 * prioridade para a do quadro inteiro — senão o mesmo cão vira dois alvos (visto
 * no teste de ponta a ponta) e a caixa do alvo encolhe.
 */
export function fundirDeteccoes(principal, doRecorte, ret, iouMax = 0.5, contidoMax = 0.6) {
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const duplicata = (a, b) => {
    const i = inter(a, b), aa = a.w * a.h, ab = b.w * b.h;
    return (aa + ab - i > 0 && i / (aa + ab - i) > iouMax) || (Math.min(aa, ab) > 0 && i / Math.min(aa, ab) > contidoMax);
  };
  const borda = 0.02;
  const mapeadas = (doRecorte || []).map(d => ({
    ...d, x: ret.x + d.x * ret.w, y: ret.y + d.y * ret.h, w: d.w * ret.w, h: d.h * ret.h, doRecorte: true,
    cortada: d.x <= borda || d.y <= borda || d.x + d.w >= 1 - borda || d.y + d.h >= 1 - borda,
  }));
  const prioridade = d => (d.cortada ? d.score - 1 : d.score);
  const todas = [...(principal || []), ...mapeadas].sort((a, b) => prioridade(b) - prioridade(a));
  const ficam = [];
  for (const d of todas) if (!ficam.some(f => f.classe === d.classe && duplicata(f, d))) ficam.push(d);
  return ficam;
}

/**
 * Estado do segundo estágio: refino por alvo e confirmação por ladrilho.
 * Puro — quem recorta e chama o classificador é o orquestrador.
 */
export class FaunaPista {
  constructor(cfg = {}) {
    this.cfg = { ...CFG_FAUNA, ...cfg };
    this.reiniciar();
  }

  reiniciar() {
    this.refinos = new Map();   // id do alvo → { categoria, score, em }
    this.ladrilhos = new Map(); // índice → { categoria, seguidas, em, caixa, score }
    this.proximo = 0;
  }

  /** Alvo precisa ser (re)classificado agora? */
  precisaRefino(id, t) {
    const r = this.refinos.get(id);
    return !r || t - r.em >= this.cfg.refinoIntervaloMs;
  }

  registrarRefino(id, resultados, t) {
    const c = categoriaDe(resultados);
    const ant = this.refinos.get(id);
    if (c && c.score >= this.cfg.refinoMin) {
      // categoria nova só substitui a anterior se vier mais forte (evita "piscar" entre CÃO e GATO)
      if (!ant || !ant.categoria || ant.categoria === c.categoria || c.score > ant.score) this.refinos.set(id, { ...c, em: t });
      else this.refinos.set(id, { ...ant, em: t });
    } else this.refinos.set(id, { ...(ant || { categoria: null, score: 0 }), em: t });
  }

  refino(id) {
    const r = this.refinos.get(id);
    return r && r.categoria ? { categoria: r.categoria, score: r.score } : null;
  }

  esquecer(vivos) { for (const id of this.refinos.keys()) if (!vivos.has(id)) this.refinos.delete(id); }

  /** Próximos índices de ladrilho a varrer (rodízio). */
  proximosLadrilhos(total, n = 2) {
    const out = [];
    for (let k = 0; k < Math.min(n, total); k++) { out.push(this.proximo % total); this.proximo = (this.proximo + 1) % total; }
    return out;
  }

  /** Leitura de um ladrilho; confirma depois de `confirmacoes` leituras seguidas da mesma categoria. */
  registrarLadrilho(indice, caixa, resultados, t) {
    const c = categoriaDe(resultados);
    const ant = this.ladrilhos.get(indice);
    if (!c || c.score < this.cfg.varreduraMin) { this.ladrilhos.delete(indice); return null; }
    const seguidas = ant && ant.categoria === c.categoria && t - ant.em <= this.cfg.janelaMs ? ant.seguidas + 1 : 1;
    this.ladrilhos.set(indice, { categoria: c.categoria, score: c.score, seguidas, em: t, caixa });
    return seguidas >= this.cfg.confirmacoes ? this.ladrilhos.get(indice) : null;
  }

  /** Achados confirmados e ainda recentes. */
  achados(t) {
    const out = [];
    for (const [indice, l] of this.ladrilhos) {
      if (l.seguidas < this.cfg.confirmacoes) continue;
      if (t - l.em > this.cfg.janelaMs) { this.ladrilhos.delete(indice); continue; }
      out.push({ indice, ...l, ...CATEGORIAS[l.categoria] });
    }
    return out;
  }
}
