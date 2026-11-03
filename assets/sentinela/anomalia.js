/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — modelo estatístico de normalidade da cena (ESM puro)

   As regras (zona restrita, queda, corrida) só pegam o que alguém pensou
   em escrever. Este modelo cobre o resto: APRENDE, sem rótulo, onde as
   pessoas costumam estar e a que velocidade costumam passar em cada
   região do quadro — e acusa o que foge disso.

   · Grade G×H sobre o quadro. Em cada célula: contagem de presença e
     média/variância ONLINE da velocidade (algoritmo de Welford — uma
     passada, memória constante, numericamente estável).
   · Raridade: P(célula) = (n_c + α) / (N + α·células). Presença numa
     célula que quase nunca é ocupada = "local atípico".
   · Velocidade: escore-z em relação ao histórico da própria célula.
   · Esquecimento exponencial por minuto: a cena muda (layout, turno) e
     o modelo precisa esquecer devagar para não acusar o novo normal.
   · Aquecimento: nada é acusado antes de N amostras. Um modelo que
     ainda não conhece a cena não tem base para chamar algo de anômalo.
   ═══════════════════════════════════════════════════════════════════════ */
import { LIMIARES } from './config.js';
import { clamp } from './geometria.js';

const L = LIMIARES.anomalia;

export class ModeloNormalidade {
  constructor(cfg = {}) {
    this.cfg = { ...L, ...cfg };
    [this.gx, this.gy] = this.cfg.grade;
    this.reiniciar();
  }

  reiniciar() {
    const n = this.gx * this.gy;
    this.n = new Float64Array(n);       // presença (decaída)
    this.vN = new Float64Array(n);      // Welford: contagem
    this.vMedia = new Float64Array(n);  //          média
    this.vM2 = new Float64Array(n);     //          soma dos quadrados dos desvios
    this.total = 0;
    this.amostras = 0;                  // amostras reais (sem decaimento) — governa o aquecimento
    this.ultimoDecaimento = null;
  }

  celula(x, y) {
    const i = clamp(Math.floor(x * this.gx), 0, this.gx - 1);
    const j = clamp(Math.floor(y * this.gy), 0, this.gy - 1);
    return j * this.gx + i;
  }

  get aquecido() { return this.amostras >= this.cfg.aquecimentoAmostras; }

  /** Avalia ANTES de aprender: a amostra não pode validar a si mesma. */
  avaliar(x, y, velocidade) {
    const c = this.celula(x, y);
    const cells = this.gx * this.gy, alfa = 0.5;
    const p = (this.n[c] + alfa) / (this.total + alfa * cells);
    let z = 0;
    if (this.vN[c] >= 20) {
      const desvio = Math.sqrt(this.vM2[c] / (this.vN[c] - 1));
      z = (velocidade - this.vMedia[c]) / Math.max(desvio, 0.05);
    }
    return {
      celula: c, prob: p, z,
      rara: this.aquecido && p < this.cfg.probRara,
      rapida: this.aquecido && this.vN[c] >= 20 && z >= this.cfg.zVelocidade,
    };
  }

  aprender(x, y, velocidade, t) {
    this.#decair(t);
    const c = this.celula(x, y);
    this.n[c] += 1; this.total += 1; this.amostras += 1;
    const k = ++this.vN[c];
    const d = velocidade - this.vMedia[c];
    this.vMedia[c] += d / k;
    this.vM2[c] += d * (velocidade - this.vMedia[c]);
  }

  #decair(t) {
    if (t == null) return;
    if (this.ultimoDecaimento == null) { this.ultimoDecaimento = t; return; }
    const min = (t - this.ultimoDecaimento) / 60000;
    if (min < 1) return;
    const f = Math.pow(this.cfg.esquecimentoPorMin, min);
    for (let i = 0; i < this.n.length; i++) this.n[i] *= f;
    this.total *= f;
    this.ultimoDecaimento = t;
  }

  /** Mapa de calor normalizado [0,1] por célula (para o HUD). */
  mapaDeCalor() {
    let max = 0;
    for (const v of this.n) if (v > max) max = v;
    return Array.from(this.n, v => (max > 0 ? v / max : 0));
  }
}
