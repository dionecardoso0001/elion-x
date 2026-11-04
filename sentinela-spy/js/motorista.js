/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — analisador do MODO MOTORISTA (ESM puro)

   Entrada por quadro: os 478 pontos do Face Landmarker + blendshapes,
   o aspecto do quadro, o flagrante de celular (detector de objetos) e a
   velocidade do GPS quando houver. Saída: métricas, CONDIÇÕES ativas
   (estados contínuos que mantêm sirene/voz) e EVENTOS pontuais.

   Os quatro sinais e de onde vêm:
   ─ OLHO: EAR (Eye Aspect Ratio, Soukupová & Čech, 2016) fundido ao
     blendshape eyeBlink do MediaPipe. EAR = (|p2−p6| + |p3−p5|) / 2|p1−p4|.
     A linha de base é do PRÓPRIO condutor (calibração), não um número
     universal — olhos diferem, câmeras diferem, iluminação muda.
   ─ PERCLOS P80: proporção de tempo, numa janela de 1 minuto, com o olho
     ≥ 80% fechado. Reflete fechamentos LENTOS ("pálpebra pesada"), não
     piscadas — por isso episódios curtos (< 0,4 s) ficam de fora.
   ─ CABEÇA: normal geométrica da face = (testa→queixo) × (bochecha→bochecha)
     em coordenadas de câmera. Dá guinada e arfagem com sinal correto sem
     depender da convenção da matriz de transformação; a rolagem sai da
     linha entre os cantos externos dos olhos. Tudo RELATIVO à postura
     neutra calibrada (o celular no painel olha de baixo para cima).
   ─ BOCA: blendshape jawOpen e MAR (abertura vertical / largura).

   O que este módulo NÃO é: diagnóstico médico. "Tontura" e "mal súbito"
   são inferências comportamentais (postura, oscilação, ausência) — o
   texto dos alertas diz "possível" e a documentação diz por quê.
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES } from './config.js';
import {
  clamp, graus, sub3, cruz3, normaliza3, mediana, desvioPadrao,
  regressaoLinear, aparar, caixaDePontos, centro, pontoNoPoligono,
} from './geometria.js';

/**
 * Celular "junto ao condutor": só conta o aparelho dentro de uma região
 * em torno do rosto (lados e abaixo, onde ficam ouvido e mãos). Um
 * celular no suporte do painel, longe do rosto, não é uso ao volante.
 */
export function celularJuntoAoRosto(objetos, pontos, scoreMin = 0.45) {
  if (!objetos?.length || !pontos?.length) return false;
  const f = caixaDePontos(pontos, -1);
  if (!f) return false;
  const regiao = [
    { x: f.x - f.w, y: f.y - 0.3 * f.h }, { x: f.x + 2 * f.w, y: f.y - 0.3 * f.h },
    { x: f.x + 2 * f.w, y: f.y + 3 * f.h }, { x: f.x - f.w, y: f.y + 3 * f.h },
  ];
  return objetos.some(o => o.classe === 'cell phone' && o.score >= scoreMin && pontoNoPoligono(centro(o), regiao));
}

/* Índices da malha facial MediaPipe (468 + 10 de íris). "Direito/esquerdo"
   são do SUJEITO, como nos blendshapes. */
export const OLHO_DIREITO = [33, 160, 158, 133, 153, 144];
export const OLHO_ESQUERDO = [362, 385, 387, 263, 373, 380];
export const BOCA = { cima: 13, baixo: 14, cantoA: 61, cantoB: 291 };
export const FACE = { testa: 10, queixo: 152, bochechaA: 234, bochechaB: 454, olhoA: 33, olhoB: 263, nariz: 1 };

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Eye Aspect Ratio de um olho, em coordenadas físicas (x corrigido pelo aspecto). */
export function ear(p, idx, aspecto = 1) {
  const P = i => ({ x: p[i].x * aspecto, y: p[i].y });
  const [p1, p2, p3, p4, p5, p6] = idx.map(P);
  const horiz = d2(p1, p4);
  return horiz > 1e-6 ? (d2(p2, p6) + d2(p3, p5)) / (2 * horiz) : 0;
}

/** Mouth Aspect Ratio: abertura interna dos lábios / largura entre os cantos. */
export function mar(p, aspecto = 1) {
  const P = i => ({ x: p[i].x * aspecto, y: p[i].y });
  const larg = d2(P(BOCA.cantoA), P(BOCA.cantoB));
  return larg > 1e-6 ? d2(P(BOCA.cima), P(BOCA.baixo)) / larg : 0;
}

/**
 * Pose da cabeça em graus. Convenção de câmera do MediaPipe: x para a
 * direita, y para baixo, z crescendo para longe da câmera (escala de z ≈ x).
 *   yaw   > 0 → rosto virado para a DIREITA da imagem
 *   pitch > 0 → rosto voltado para BAIXO
 *   roll  > 0 → olho da direita da imagem mais baixo
 */
export function poseDaCabeca(p, aspecto = 1) {
  const P = i => ({ x: p[i].x * aspecto, y: p[i].y, z: (p[i].z || 0) * aspecto });
  const v = sub3(P(FACE.queixo), P(FACE.testa));           // eixo "para baixo" da face
  const h = sub3(P(FACE.bochechaB), P(FACE.bochechaA));    // eixo "para a direita" da face
  const f = normaliza3(cruz3(v, h));                       // normal: (0,0,−1) de frente para a câmera
  const a = P(FACE.olhoA), b = P(FACE.olhoB);
  return {
    yaw: graus(Math.atan2(f.x, -f.z)),
    pitch: graus(Math.atan2(f.y, -f.z)),
    roll: graus(Math.atan2(b.y - a.y, b.x - a.x)),
  };
}

/* ── MÃOS pelo esqueleto (Pose Landmarker, 33 pontos) ──────────────────────
   0 nariz · 2/5 olhos · 11/12 ombros · 15/16 punhos · 17/18 mínimos ·
   19/20 indicadores · 21/22 polegares · 23/24 quadris. Distâncias em
   unidades FÍSICAS (x corrigido pelo aspecto) e relativas ao próprio corpo:
   a distância entre os olhos e a largura dos ombros são a régua — vale perto
   ou longe da câmera. */
const MAOS = [[15, 17, 19, 21], [16, 18, 20, 22]];
const visivel = (p, min) => p && (p.visibility ?? 1) >= min;

/** Pontos visíveis de cada mão (punho, mínimo, indicador, polegar) em coordenadas físicas. */
export function pontosDasMaos(pose, aspecto = 1, visMin = 0.3) {
  if (!pose || pose.length < 23) return [];
  const out = [];
  for (const idx of MAOS) {
    const pts = idx.filter(i => visivel(pose[i], visMin)).map(i => ({ x: pose[i].x * aspecto, y: pose[i].y }));
    if (pts.length >= 2) out.push({ pontos: pts, centro: { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } });
  }
  return out;
}

/** Centros dos olhos e a distância entre eles: da malha facial (precisa) ou, sem ela, da pose. */
export function olhosDe(rostoPontos, pose, aspecto = 1) {
  const media = idx => ({ x: idx.reduce((s, i) => s + rostoPontos[i].x, 0) / idx.length * aspecto, y: idx.reduce((s, i) => s + rostoPontos[i].y, 0) / idx.length });
  let a = null, b = null;
  if (rostoPontos?.length >= 468) { a = media(OLHO_DIREITO); b = media(OLHO_ESQUERDO); }
  else if (pose && visivel(pose[2], 0.3) && visivel(pose[5], 0.3)) {
    a = { x: pose[2].x * aspecto, y: pose[2].y }; b = { x: pose[5].x * aspecto, y: pose[5].y };
  }
  if (!a) return null;
  const distancia = Math.hypot(a.x - b.x, a.y - b.y);
  return distancia > 1e-4 ? { a, b, distancia } : null;
}

/**
 * Alguma mão sobre um dos olhos (coçando ou cobrindo)? Raio = 0,75 × distância
 * entre os olhos: cobre a órbita, mas não a mão no queixo ou na boca (≥ 1 × a
 * distância), postura comum de quem pensa ou come.
 */
export function maoNosOlhos(pose, rostoPontos, aspecto = 1) {
  const olhos = olhosDe(rostoPontos, pose, aspecto);
  if (!olhos) return false;
  const raio = 0.75 * olhos.distancia;
  return pontosDasMaos(pose, aspecto).some(m => m.pontos.some(p => [olhos.a, olhos.b].some(o => Math.hypot(p.x - o.x, p.y - o.y) <= raio)));
}

/**
 * Mão sobre o CENTRO do peito: entre os ombros (sem as bordas, onde fica o cinto)
 * e de 0,15 a 1,0 largura de ombro abaixo da linha deles. O volante fica mais
 * abaixo; ajustar o cinto passa pela lateral e dura pouco — por isso o tempo mínimo.
 */
export function maoNoPeito(pose, aspecto = 1) {
  if (!pose || pose.length < 25 || !visivel(pose[11], 0.5) || !visivel(pose[12], 0.5)) return false;
  const oA = { x: pose[11].x * aspecto, y: pose[11].y }, oB = { x: pose[12].x * aspecto, y: pose[12].y };
  const largura = Math.hypot(oA.x - oB.x, oA.y - oB.y);
  if (largura < 1e-3) return false;
  const xMin = Math.min(oA.x, oB.x) + 0.2 * largura, xMax = Math.max(oA.x, oB.x) - 0.2 * largura;
  const yOmbro = (oA.y + oB.y) / 2;
  let yMax = yOmbro + 1.0 * largura;
  if (visivel(pose[23], 0.5) && visivel(pose[24], 0.5)) yMax = Math.min(yMax, (pose[23].y + pose[24].y) / 2 - 0.1 * largura);
  return pontosDasMaos(pose, aspecto).some(m => m.centro.x >= xMin && m.centro.x <= xMax && m.centro.y >= yOmbro + 0.15 * largura && m.centro.y <= yMax);
}

/**
 * Entre os esqueletos da cena, o do CONDUTOR: o nariz mais perto do rosto
 * rastreado; sem rosto, o de ombros mais largos (o mais perto da câmera).
 */
export function esqueletoDoCondutor(poses, rostoPontos, aspecto = 1) {
  if (!poses?.length) return null;
  if (poses.length === 1) return poses[0];
  const f = rostoPontos?.length >= 468 ? caixaDePontos(rostoPontos, -1) : null;
  if (f) {
    const c = centro(f);
    return poses.reduce((m, p) => (Math.hypot((p[0].x - c.x) * aspecto, p[0].y - c.y) < Math.hypot((m[0].x - c.x) * aspecto, m[0].y - c.y) ? p : m));
  }
  const largura = p => (p[11] && p[12] ? Math.hypot((p[11].x - p[12].x) * aspecto, p[11].y - p[12].y) : 0);
  return poses.reduce((m, p) => (largura(p) > largura(m) ? p : m));
}

const L = LIMIARES.motorista;
const PISCADA_MAX_S = 0.4;   // episódio mais curto que isso é piscada, não fechamento lento
const PISCADA_MIN_S = 0.05;
const CINCO_MIN = 300000;

export class AnalisadorMotorista {
  constructor(cfg = {}) {
    this.cfg = { ...L, ...cfg };
    this.reiniciar();
  }

  reiniciar() {
    this.base = { yaw: 0, pitch: 0, roll: 0, ear: 0.28 };
    this.calib = { amostras: [], desde: null, pronta: false };
    this.tAnterior = null;
    this.presenca = [];            // {t, dt} quadros COM rosto — cobertura do PERCLOS
    this.fechamentos = [];         // {inicio, fim} episódios lentos (≥ 0,4 s)
    this.piscadas = [];            // {t}
    this.episodio = null;          // fechamento em curso: {inicio}
    this.bocejoDesde = null; this.bocejoContado = false; this.bocejos = [];
    this.acenoPico = null; this.acenos = [];
    this.longos = [];              // fechamentos ≥ microssono (para o índice de fadiga)
    this.foraDesde = null; this.pendendoDesde = null; this.malDesde = null;
    this.celularVisto = null; this.celularDesde = null;
    this.ultimaPresenca = null; this.tempoPresente = 0;
    this.cabeca = [];              // {t, roll, yaw, pitch} — 5 s para instabilidade
    this.maoOlhos = { desde: null, visto: null };
    this.maoPeito = { desde: null, visto: null };
    this.ultimo = null;
  }

  /** Cronômetro com tolerância: a pose roda a ~8 Hz e "pisca" — 0,6 s sem ver não zera. */
  #cronometro(st, agora, t) {
    if (agora) { st.visto = t; if (st.desde == null) st.desde = t; }
    else if (st.visto != null && t - st.visto > this.cfg.maoToleranciaMs) { st.desde = null; st.visto = null; }
    return st.desde == null ? 0 : (t - st.desde) / 1000;
  }

  /** Mão no peito / nos olhos: valem com e sem rosto visível, e já durante a calibração. */
  #condicoesMaos(maos, emMovimento, condicoes) {
    if (maos.peitoS >= this.cfg.maoPeitoS) {
      condicoes.push({ chave: 'mao_peito', nivel: emMovimento ? 'critico' : 'aviso', titulo: 'MÃO NO PEITO',
        detalhe: `mão sobre o centro do peito há ${maos.peitoS.toFixed(1)} s — possível dor no peito; checagem de saúde iniciada`, voz: null });
    }
    if (maos.olhosS >= this.cfg.maoOlhosS) {
      const crit = emMovimento && maos.olhosS >= this.cfg.maoOlhosCriticoS;   // olho coberto em movimento = via fora de vista
      condicoes.push({ chave: 'mao_olhos', nivel: crit ? 'critico' : 'aviso', titulo: 'MÃO NOS OLHOS',
        detalhe: `mão sobre os olhos há ${maos.olhosS.toFixed(1)} s — sono, irritação ou mal-estar; checagem de saúde iniciada`, voz: null });
    }
  }

  recalibrar() {
    this.calib = { amostras: [], desde: null, pronta: false };
  }

  /** Troca de perfil de sensibilidade a quente (não perde calibração nem histórico). */
  ajustar(cfg) { Object.assign(this.cfg, cfg); }

  /**
   * @param {{t:number, rosto:null|{pontos:Array, blend?:Object}, aspecto:number,
   *          celular?:boolean|null, velocidade?:number|null, esqueleto?:Array|null, escuro?:boolean}} e
   *   esqueleto: os 33 pontos da Pose do condutor (mãos nos olhos / no peito)
   */
  processar({ t, rosto, aspecto = 16 / 9, celular = null, velocidade = null, esqueleto = null, escuro = false }) {
    const dt = this.tAnterior == null ? 0 : Math.min(200, Math.max(0, t - this.tAnterior));
    this.tAnterior = t;
    const condicoes = [], eventos = [];
    const emMovimento = velocidade == null ? true : velocidade >= this.cfg.velocidadeMinimaMs;
    const rostoPts = rosto?.pontos?.length >= 468 ? rosto.pontos : null;
    const maos = {
      olhosS: this.#cronometro(this.maoOlhos, !!esqueleto && maoNosOlhos(esqueleto, rostoPts, aspecto), t),
      peitoS: this.#cronometro(this.maoPeito, !!esqueleto && maoNoPeito(esqueleto, aspecto), t),
    };
    this.#condicoesMaos(maos, emMovimento, condicoes);
    const fechar = r => {   // motivo da checagem de saúde: o sinal mais grave ativo
      const ordem = ['mao_peito', 'mal_subito', ...(escuro ? [] : ['ausente']), 'mao_olhos'];
      r.metricas.checagem = ordem.find(k => r.condicoes.some(c => c.chave === k)) || null;
      r.metricas.maoOlhosS = maos.olhosS; r.metricas.maoPeitoS = maos.peitoS;
      return r;
    };

    // celular: o detector roda a ~2 Hz; vale o último flagrante recente
    if (celular === true) { this.celularVisto = t; if (this.celularDesde == null) this.celularDesde = t; }
    if (this.celularVisto != null && t - this.celularVisto > 1500) { this.celularVisto = null; this.celularDesde = null; }

    if (!rostoPts) return fechar(this.#semRosto(t, emMovimento, condicoes, eventos, escuro));

    const p = rosto.pontos, bl = rosto.blend || {};
    const earMed = (ear(p, OLHO_DIREITO, aspecto) + ear(p, OLHO_ESQUERDO, aspecto)) / 2;
    const marV = mar(p, aspecto);
    const pose = poseDaCabeca(p, aspecto);
    const blink = bl.eyeBlinkLeft != null && bl.eyeBlinkRight != null ? (bl.eyeBlinkLeft + bl.eyeBlinkRight) / 2 : null;
    const jaw = bl.jawOpen ?? null;

    this.ultimaPresenca = t;
    this.tempoPresente += dt;
    this.presenca.push({ t, dt });
    aparar(this.presenca, t, this.cfg.perclosJanelaMs);

    // ── calibração: linha de base da postura neutra e do olho aberto ──
    if (!this.calib.pronta) {
      if (this.calib.desde == null) this.calib.desde = t;
      if (blink == null || blink < 0.35) this.calib.amostras.push({ ...pose, ear: earMed });
      const decorrido = t - this.calib.desde;
      if (decorrido >= this.cfg.calibracaoMs && this.calib.amostras.length >= 30) {
        const a = this.calib.amostras;
        this.base = {
          yaw: mediana(a.map(s => s.yaw)), pitch: mediana(a.map(s => s.pitch)),
          roll: mediana(a.map(s => s.roll)), ear: Math.max(0.12, mediana(a.map(s => s.ear))),
        };
        this.calib.pronta = true;
        eventos.push({ chave: 'calibrado', nivel: 'info', titulo: 'CALIBRAÇÃO CONCLUÍDA', detalhe: `linha de base: EAR ${this.base.ear.toFixed(3)} · arfagem ${this.base.pitch.toFixed(0)}°` });
      }
    }

    const rel = {
      yaw: pose.yaw - this.base.yaw,
      pitch: pose.pitch - this.base.pitch,
      roll: pose.roll - this.base.roll,
    };

    // ── fechamento do olho: EAR relativo à base, fundido ao blendshape ──
    const fechEAR = clamp((1 - earMed / this.base.ear) / 0.7, 0, 1);
    const fechamento = blink == null ? fechEAR : 0.6 * blink + 0.4 * fechEAR;
    // olhar para baixo abaixa a pálpebra sem sono: exige mais para chamar de "fechado"
    const limiarFechado = rel.pitch > 15 ? Math.max(this.cfg.fechadoP80, 0.9) : this.cfg.fechadoP80;
    const fechado = fechamento >= limiarFechado;

    // linha de base do olho acompanha mudanças lentas de luz (só com olho claramente aberto)
    if (this.calib.pronta && (blink == null || blink < 0.15) && Math.abs(rel.yaw) < 15 && Math.abs(rel.pitch) < 10 && fechEAR < 0.3) {
      this.base.ear = 0.995 * this.base.ear + 0.005 * earMed;
    }

    // ── episódios de fechamento: piscada × fechamento lento × microssono ──
    let duracaoFechado = 0;
    if (fechado) {
      if (!this.episodio) this.episodio = { inicio: t };
      duracaoFechado = (t - this.episodio.inicio) / 1000;
    } else if (this.episodio) {
      const dur = (t - this.episodio.inicio) / 1000;
      if (dur >= PISCADA_MIN_S && dur < PISCADA_MAX_S) this.piscadas.push({ t });
      if (dur >= PISCADA_MAX_S) this.fechamentos.push({ inicio: this.episodio.inicio, fim: t });
      if (dur >= this.cfg.microssonoS) {
        this.longos.push({ t });
        eventos.push({ chave: 'fechamento_longo', nivel: 'aviso', titulo: 'FECHAMENTO LONGO DOS OLHOS', detalhe: `${dur.toFixed(1)} s com os olhos fechados` });
      }
      this.episodio = null;
    }
    aparar(this.piscadas, t, 60000);
    aparar(this.longos, t, CINCO_MIN);
    this.fechamentos = this.fechamentos.filter(f => t - f.fim <= this.cfg.perclosJanelaMs);

    // ── PERCLOS (P80, fechamentos lentos, janela de 60 s ponderada por tempo) ──
    const ini = t - this.cfg.perclosJanelaMs;
    let fechadoMs = 0;
    for (const f of this.fechamentos) fechadoMs += Math.max(0, f.fim - Math.max(f.inicio, ini));
    if (this.episodio && duracaoFechado >= PISCADA_MAX_S) fechadoMs += t - Math.max(this.episodio.inicio, ini);
    let coberturaMs = 0;
    for (const s of this.presenca) coberturaMs += s.dt;
    const perclos = coberturaMs > 0 ? clamp(fechadoMs / coberturaMs, 0, 1) : 0;

    // ── bocejo ──
    const bocaAberta = (jaw != null && jaw >= this.cfg.bocejoJawOpen) || marV >= 0.6;
    if (bocaAberta) {
      if (this.bocejoDesde == null) { this.bocejoDesde = t; this.bocejoContado = false; }
      if (!this.bocejoContado && (t - this.bocejoDesde) / 1000 >= this.cfg.bocejoMinS) {
        this.bocejoContado = true;
        this.bocejos.push({ t });
        eventos.push({ chave: 'bocejo', nivel: 'info', titulo: 'BOCEJO DETECTADO', detalhe: `${this.bocejos.length} nos últimos 5 min` });
      }
    } else { this.bocejoDesde = null; this.bocejoContado = false; }
    aparar(this.bocejos, t, CINCO_MIN);

    // ── aceno de cabeça (cochilo leve): desce > 15° e volta < 5° em até 1,5 s ──
    if (rel.pitch > 15 && !this.acenoPico) this.acenoPico = { t };
    if (this.acenoPico && rel.pitch < 5) {
      if (t - this.acenoPico.t <= 1500) this.acenos.push({ t });
      this.acenoPico = null;
    }
    if (this.acenoPico && t - this.acenoPico.t > 1500) this.acenoPico = null;
    aparar(this.acenos, t, CINCO_MIN);

    // ── série da cabeça para instabilidade e para "parada" ──
    this.cabeca.push({ t, roll: rel.roll, yaw: rel.yaw, pitch: rel.pitch });
    aparar(this.cabeca, t, this.cfg.instabilidadeJanelaMs);
    const inst = this.#instabilidade();
    const recente = this.cabeca.filter(s => t - s.t <= 1000);
    const parada = recente.length >= 5
      && desvioPadrao(recente.map(s => s.pitch)) < 4 && desvioPadrao(recente.map(s => s.roll)) < 4;

    const metricas = {
      presente: true, calibrando: !this.calib.pronta,
      progressoCalibracao: this.calib.pronta ? 1 : clamp((t - (this.calib.desde ?? t)) / this.cfg.calibracaoMs, 0, 1),
      ear: earMed, earBase: this.base.ear, mar: marV, jawOpen: jaw, blink,
      fechamento, fechado, duracaoFechado,
      perclos, perclosCobertura: coberturaMs / 1000,
      piscadasMin: this.piscadas.length,
      bocejos5min: this.bocejos.length, acenos5min: this.acenos.length, longos5min: this.longos.length,
      yaw: rel.yaw, pitch: rel.pitch, roll: rel.roll,
      instabilidade: inst, emMovimento,
      celular: this.celularVisto != null,
    };
    metricas.indiceFadiga = Math.round(100 * clamp(
      0.5 * clamp(perclos / 0.15, 0, 1) + 0.2 * clamp(this.bocejos.length / 3, 0, 1)
      + 0.15 * clamp(this.acenos.length / 3, 0, 1) + 0.15 * clamp(this.longos.length / 3, 0, 1), 0, 1));

    if (!this.calib.pronta) { this.ultimo = metricas; return fechar({ metricas, condicoes, eventos }); }

    // ═════════════════ CONDIÇÕES ═════════════════
    const nivel = n => (emMovimento ? n : 'aviso'); // parado (GPS): nada vira sirene

    if (duracaoFechado >= this.cfg.microssonoS) {
      condicoes.push({ chave: 'microssono', nivel: nivel('critico'), titulo: 'OLHOS FECHADOS',
        detalhe: `${duracaoFechado.toFixed(1)} s sem abrir os olhos — risco de microssono`,
        voz: 'Acorde! Olhos fechados detectados. Estacione o veículo em local seguro imediatamente.' });
    }

    const cobertura = coberturaMs >= this.cfg.perclosCoberturaMinMs;
    if (cobertura && perclos >= this.cfg.perclosCritico) {
      condicoes.push({ chave: 'fadiga', nivel: nivel('critico'), titulo: 'FADIGA SEVERA',
        detalhe: `PERCLOS ${(perclos * 100).toFixed(1)}% no último minuto`,
        voz: 'Alerta de fadiga severa. Seus olhos estão se fechando com frequência. Estacione em local seguro e descanse.' });
    } else if (cobertura && perclos >= this.cfg.perclosAviso) {
      condicoes.push({ chave: 'fadiga', nivel: 'aviso', titulo: 'SINAIS DE FADIGA',
        detalhe: `PERCLOS ${(perclos * 100).toFixed(1)}% no último minuto`,
        voz: 'Atenção. Sinais de cansaço detectados. Planeje uma parada para descansar.' });
    }

    if (this.bocejos.length >= this.cfg.bocejosAviso) {
      condicoes.push({ chave: 'bocejos', nivel: 'aviso', titulo: 'BOCEJOS FREQUENTES',
        detalhe: `${this.bocejos.length} bocejos em 5 minutos`,
        voz: 'Você bocejou várias vezes. Sinal de sonolência: faça uma pausa assim que possível.' });
    }

    // cabeça pendendo com olho fechado = cochilo
    if (rel.pitch >= this.cfg.pendendoPitchGraus && fechamento >= 0.5) {
      if (this.pendendoDesde == null) this.pendendoDesde = t;
    } else this.pendendoDesde = null;
    if (this.pendendoDesde != null && t - this.pendendoDesde >= 1000) {
      condicoes.push({ chave: 'pendendo', nivel: nivel('critico'), titulo: 'CABEÇA PENDENDO',
        detalhe: 'cabeça caída com olhos fechando — padrão de cochilo',
        voz: 'Acorde! Sua cabeça está caindo. Estacione o veículo agora.' });
    }

    // distração: olhar fora da via com olho aberto
    const fora = !fechado && (Math.abs(rel.yaw) >= this.cfg.distracaoYawGraus || rel.pitch >= this.cfg.distracaoPitchGraus);
    if (fora) { if (this.foraDesde == null) this.foraDesde = t; } else this.foraDesde = null;
    const foraS = this.foraDesde == null ? 0 : (t - this.foraDesde) / 1000;
    if (emMovimento && foraS >= this.cfg.distracaoAvisoS) {
      const crit = foraS >= this.cfg.distracaoCriticoS;
      condicoes.push({ chave: 'distracao', nivel: crit ? 'critico' : 'aviso', titulo: 'OLHAR FORA DA VIA',
        detalhe: `${foraS.toFixed(1)} s desviando o olhar (guinada ${rel.yaw.toFixed(0)}°, arfagem ${rel.pitch.toFixed(0)}°)`,
        voz: crit ? 'Olhe para a pista! Você está distraído há vários segundos.' : 'Atenção, mantenha os olhos na pista.' });
    }

    if (emMovimento && this.celularDesde != null && (t - this.celularDesde) / 1000 >= this.cfg.celularMinS) {
      condicoes.push({ chave: 'celular', nivel: 'aviso', titulo: 'USO DE CELULAR',
        detalhe: 'aparelho detectado junto ao condutor',
        voz: 'Atenção. Não use o celular enquanto dirige.' });
    }

    // postura anormal sustentada e SEM movimento = possível mal súbito
    const tombada = Math.abs(rel.roll) >= this.cfg.malSubitoRollGraus || rel.pitch >= this.cfg.malSubitoPitchGraus;
    if (tombada && parada) { if (this.malDesde == null) this.malDesde = t; }
    else if (!tombada) this.malDesde = null;
    if (this.malDesde != null && (t - this.malDesde) / 1000 >= this.cfg.malSubitoS) {
      condicoes.push({ chave: 'mal_subito', nivel: nivel('critico'), titulo: 'POSTURA ANORMAL',
        detalhe: `cabeça tombada e imóvel (rolagem ${rel.roll.toFixed(0)}°, arfagem ${rel.pitch.toFixed(0)}°) — possível mal súbito`,
        voz: 'Alerta! Postura anormal detectada. Se estiver passando mal, pare o veículo em local seguro e peça ajuda. Ligue 192.' });
    }

    if (inst.ativo && !fechado) {
      condicoes.push({ chave: 'instabilidade', nivel: 'aviso', titulo: 'INSTABILIDADE DA CABEÇA',
        detalhe: `oscilação ${inst.reversoes}× em 5 s (σ rolagem ${inst.stdRoll.toFixed(1)}°) — possível tontura [experimental]`,
        voz: 'Atenção. Detectei oscilação da cabeça. Se sentir tontura, pare em local seguro.' });
    }

    this.ultimo = metricas;
    return fechar({ metricas, condicoes, eventos });
  }

  #semRosto(t, emMovimento, condicoes, eventos, escuro = false) {
    if (this.episodio) this.episodio = null;   // sem rosto não se mede olho
    this.foraDesde = null; this.pendendoDesde = null; this.malDesde = null;
    const ausenteS = this.ultimaPresenca == null ? 0 : (t - this.ultimaPresenca) / 1000;
    const metricas = {
      ...(this.ultimo || {}), presente: false, ausenteS,
      calibrando: !this.calib.pronta, emMovimento, celular: this.celularVisto != null,
    };
    // só acusa ausência de quem ESTAVA lá: câmera mal posicionada não é desmaio
    if (this.calib.pronta && this.tempoPresente >= 3000 && ausenteS >= this.cfg.ausenteS) {
      condicoes.push({ chave: 'ausente', nivel: emMovimento ? 'critico' : 'aviso', titulo: 'MOTORISTA FORA DE VISÃO',
        detalhe: escuro
          ? `rosto não detectado há ${ausenteS.toFixed(1)} s — pouca luz na cabine: a câmera não enxerga o rosto (luz interna ou câmera infravermelha)`
          : `rosto não detectado há ${ausenteS.toFixed(1)} s — possível desmaio ou câmera obstruída`,
        voz: 'Alerta! Não consigo ver seu rosto. Se estiver passando mal, pare o veículo e peça ajuda.' });
    }
    return { metricas, condicoes, eventos };
  }

  /** EXPERIMENTAL — oscilação da cabeça: dispersão sem tendência + inversões de sentido. */
  #instabilidade() {
    const s = this.cabeca;
    const vazio = { ativo: false, stdRoll: 0, stdYaw: 0, reversoes: 0 };
    if (s.length < 15) return vazio;
    const t0 = s[0].t;
    const residuo = campo => {
      const r = regressaoLinear(s.map(a => [(a.t - t0) / 1000, a[campo]]));
      return s.map(a => a[campo] - (r.inclinacao * (a.t - t0) / 1000 + r.intercepto));
    };
    const rr = residuo('roll'), ry = residuo('yaw');
    const stdRoll = desvioPadrao(rr), stdYaw = desvioPadrao(ry);
    // inversões: mudanças de sentido entre extremos que distam ≥ 2°
    const inversoes = serie => {
      let n = 0, dir = 0, ext = serie[0];
      for (const v of serie) {
        if (dir >= 0 && v < ext - 2) { if (dir > 0) n++; dir = -1; ext = v; }
        else if (dir <= 0 && v > ext + 2) { if (dir < 0) n++; dir = 1; ext = v; }
        else if ((dir > 0 && v > ext) || (dir < 0 && v < ext)) ext = v;
      }
      return n;
    };
    const reversoes = Math.max(inversoes(rr), inversoes(ry));
    const ativo = (stdRoll >= this.cfg.instabilidadeRollStd || stdYaw >= this.cfg.instabilidadeYawStd)
      && reversoes >= this.cfg.instabilidadeReversoes;
    return { ativo, stdRoll, stdYaw, reversoes };
  }
}
