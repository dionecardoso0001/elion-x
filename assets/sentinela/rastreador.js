/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — rastreador multi-alvo (ESM puro)

   Inspirado no SORT (Bewley et al., 2016, "Simple Online and Realtime
   Tracking"): predição por velocidade constante + associação por IoU.
   Sem Kalman completo nem re-identificação por aparência — escolha
   deliberada: roda em celular a 15–30 quadros/s sem custo mensurável.

   Por que um rastreador é pré-requisito e não enfeite: o detector só
   responde "há uma mochila AQUI, AGORA". Abandono, permanência, corrida
   e tempo-até-colisão são perguntas sobre o MESMO objeto ao longo do
   tempo — sem identidade estável, cada quadro seria um objeto novo e
   nenhum cronômetro chegaria a zero.

   Particularidades:
   · carro/caminhão/ônibus formam um grupo: o detector oscila entre essas
     classes no mesmo veículo e isso não pode partir a trilha em duas;
   · objeto ESTÁTICO ganha sobrevida maior sem detecção — o detector
     "pisca" em objeto parado e o cronômetro de abandono não pode zerar
     a cada piscada;
   · o histórico guarda a caixa BRUTA (sem suavização): a regressão do
     tempo-até-colisão precisa da medida sem o atraso do filtro.
   ═══════════════════════════════════════════════════════════════════════ */
import { iou, centro, distancia, aparar } from './geometria.js';

const GRUPO = { car: 'veiculo', truck: 'veiculo', bus: 'veiculo' };
const grupoDe = c => GRUPO[c] || c;

export class Rastreador {
  constructor(o = {}) {
    this.iouMin = o.iouMin ?? 0.2;
    this.ttlMs = o.ttlMs ?? 1200;
    this.ttlEstaticoMs = o.ttlEstaticoMs ?? 6000;
    this.scoreNovo = o.scoreNovo ?? 0.5;
    this.historicoMs = o.historicoMs ?? 4000;
    this.alfaPos = o.alfaPos ?? 0.55;   // peso da medida nova na posição
    this.alfaVel = o.alfaVel ?? 0.35;   // peso da medida nova na velocidade
    this.estaticoJanelaMs = o.estaticoJanelaMs ?? 2500;
    this.estaticoDesloc = o.estaticoDesloc ?? 0.012;
    this.aspecto = o.aspecto ?? 16 / 9;  // largura/altura do quadro, para distância física
    this.proximoId = 1;
    this.trilhas = [];
    this.intervalo = null;   // intervalo médio entre detecções (ms) — a cadência REAL do aparelho
    this.tAnterior = null;
  }

  reiniciar() { this.trilhas = []; this.proximoId = 1; this.intervalo = null; this.tAnterior = null; }

  /* TTL em tempo fixo é TTL em quadros variável: 1,2 s tolera ~36 falhas a
     30 quadros/s e NENHUMA a 0,7 quadro/s (celular fraco, aquecido, ou sem
     GPU). A sobrevida passa a ser o maior entre o TTL nominal e 3 intervalos
     reais — ou 5, para objeto parado. */
  #ttl(estatico) {
    const k = this.intervalo || 0;
    return estatico ? Math.max(this.ttlEstaticoMs, 5 * k) : Math.max(this.ttlMs, 3 * k);
  }

  /**
   * @param {Array<{classe:string, score:number, x:number, y:number, w:number, h:number}>} deteccoes
   * @param {number} t  instante em ms (monotônico)
   * @returns {Array} trilhas vivas
   */
  atualizar(deteccoes, t) {
    if (this.tAnterior != null && t > this.tAnterior) {
      const dt = t - this.tAnterior;
      this.intervalo = this.intervalo == null ? dt : 0.8 * this.intervalo + 0.2 * dt;
    }
    this.tAnterior = t;
    // 1. predição: onde cada trilha deveria estar agora
    for (const tr of this.trilhas) {
      const dt = Math.max(0, (t - tr.visto) / 1000);
      tr.px = tr.x + tr.vx * dt;
      tr.py = tr.y + tr.vy * dt;
      tr.casada = false;
    }

    // 2. pares candidatos (mesmo grupo de classe), com nota de afinidade
    const pares = [];
    for (let j = 0; j < deteccoes.length; j++) {
      const d = deteccoes[j];
      for (let i = 0; i < this.trilhas.length; i++) {
        const tr = this.trilhas[i];
        if (grupoDe(tr.classe) !== grupoDe(d.classe)) continue;
        const prev = { x: tr.px, y: tr.py, w: tr.w, h: tr.h };
        const o = iou(prev, d);
        let nota = 0;
        if (o >= this.iouMin) nota = o;
        else {
          // a baixa taxa de quadros do celular faz alvos rápidos "pularem" a
          // caixa prevista; a distância entre centros resgata esse caso, mas
          // sempre com nota inferior a qualquer IoU válido
          const lim = 0.75 * Math.max(tr.w, tr.h, d.w, d.h);
          const dist = distancia(centro(prev), centro(d));
          if (dist < lim) nota = 0.001 + 0.1 * (1 - dist / lim);
        }
        if (nota > 0) pares.push([nota, i, j]);
      }
    }

    // 3. associação gulosa pela melhor nota (suficiente para cenas de até dezenas de alvos)
    pares.sort((a, b) => b[0] - a[0]);
    const usadaT = new Set(), usadaD = new Set();
    for (const [, i, j] of pares) {
      if (usadaT.has(i) || usadaD.has(j)) continue;
      usadaT.add(i); usadaD.add(j);
      this.#atualizarTrilha(this.trilhas[i], deteccoes[j], t);
    }

    // 4. detecções sem par viram trilhas novas — só se forem convincentes
    for (let j = 0; j < deteccoes.length; j++) {
      if (usadaD.has(j)) continue;
      const d = deteccoes[j];
      if (d.score >= this.scoreNovo) this.trilhas.push(this.#nova(d, t));
    }

    // 5. trilhas sem par envelhecem; expiram pelo tempo sem detecção
    for (const tr of this.trilhas) if (!tr.casada) tr.perdidos++;
    this.trilhas = this.trilhas.filter(tr => (t - tr.visto) <= this.#ttl(tr.estatico));

    return this.trilhas;
  }

  #nova(d, t) {
    const c = centro(d);
    return {
      id: this.proximoId++,
      classe: d.classe, score: d.score,
      x: d.x, y: d.y, w: d.w, h: d.h, px: d.x, py: d.y,
      vx: 0, vy: 0,
      nasceu: t, visto: t, hits: 1, perdidos: 0, casada: true,
      estatico: false, estaticoDesde: null,
      historico: [{ t, cx: c.x, cy: c.y, w: d.w, h: d.h }],
    };
  }

  #atualizarTrilha(tr, d, t) {
    const dt = Math.max(1e-3, (t - tr.visto) / 1000);
    const antes = { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 };
    const a = this.alfaPos;
    tr.x = a * d.x + (1 - a) * tr.px;
    tr.y = a * d.y + (1 - a) * tr.py;
    tr.w = a * d.w + (1 - a) * tr.w;
    tr.h = a * d.h + (1 - a) * tr.h;
    const agora = { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 };
    const b = this.alfaVel;
    tr.vx = b * ((agora.x - antes.x) / dt) + (1 - b) * tr.vx;
    tr.vy = b * ((agora.y - antes.y) / dt) + (1 - b) * tr.vy;
    // classe: dentro do grupo veicular fica a de maior confiança recente
    if (d.classe !== tr.classe && d.score >= tr.score) tr.classe = d.classe;
    tr.score = 0.7 * tr.score + 0.3 * d.score;
    tr.visto = t; tr.hits++; tr.perdidos = 0; tr.casada = true;

    const c = centro(d);
    tr.historico.push({ t, cx: c.x, cy: c.y, w: d.w, h: d.h });
    aparar(tr.historico, t, this.historicoMs);
    this.#avaliarEstatico(tr, t);
  }

  /** Estático = o centro não saiu de um raio pequeno durante a janela inteira. */
  #avaliarEstatico(tr, t) {
    const h = tr.historico;
    const idade = t - tr.nasceu;
    if (idade < this.estaticoJanelaMs || h.length < 4) { tr.estatico = false; tr.estaticoDesde = null; return; }
    const ultimo = h[h.length - 1];
    let maxDesloc = 0;
    for (const p of h) {
      if (t - p.t > this.estaticoJanelaMs) continue;
      // distância física (corrige o aspecto: x normalizado pela largura, y pela altura)
      const dx = (p.cx - ultimo.cx) * this.aspecto, dy = p.cy - ultimo.cy;
      const dist = Math.hypot(dx, dy) / Math.hypot(this.aspecto, 1);
      if (dist > maxDesloc) maxDesloc = dist;
    }
    const parado = maxDesloc < this.estaticoDesloc;
    if (parado && !tr.estatico) tr.estaticoDesde = t - this.estaticoJanelaMs;
    if (!parado) tr.estaticoDesde = null;
    tr.estatico = parado;
  }
}
