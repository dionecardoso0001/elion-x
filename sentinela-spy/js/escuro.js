/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — visão no escuro e movimento (ESM puro, sem DOM)

   Três peças, todas sobre a LUMINÂNCIA de um quadro reduzido:

   1. MONITOR DE LUZ — média e percentis por histograma (O(n)). Com
      histerese, decide quando o ambiente está escuro.

   2. REALCE — estica a faixa [p2, p98] para [0, 255] e aplica uma gama
      que leva a mediana a ~45%. É o quadro REALÇADO que vai para os
      detectores no escuro: o detector foi treinado com imagem bem
      exposta e erra na imagem escura. O ganho é limitado (8×) porque no
      escuro total não há sinal para realçar — mais ganho só fabrica
      textura de ruído.

   3. DETECTOR DE MOVIMENTO com FUNDO DUPLO (Porikli, Ivanov & Haga,
      "Robust abandoned object detection using dual foregrounds",
      EURASIP J. Adv. Signal Process., 2008):
        · fundo CURTO (≈2 s) → o que está se MOVENDO agora;
        · fundo LONGO (≈5 min) → o que MUDOU na cena e PAROU: difere do
          fundo longo mas já foi absorvido pelo curto. É o objeto
          deixado (ou retirado) — de QUALQUER tipo, sem depender da
          classe do detector.
      O limiar se adapta ao RUÍDO medido no próprio quadro (MAD robusto):
      no escuro o sensor da câmera gera muito ruído e um limiar fixo
      acusaria "movimento" o tempo todo. Troca brusca de luz (lâmpada
      acesa, farol) altera o quadro inteiro de uma vez: os fundos são
      refeitos e o detector fica 1,5 s em estabilização, sem alarme.

   Limite físico, declarado: câmera comum sem luz nenhuma não registra
   nada — software não cria fótons. Escuro total exige câmera com
   infravermelho (IR) e iluminador.
   ═══════════════════════════════════════════════════════════════════════ */

export const CFG_LUZ = {
  escuroEntra: 0.20,     // HEURÍSTICA — luminância média (0–1) abaixo da qual a imagem está escura
  escuroSai: 0.27,       // histerese: só sai do modo noturno com folga, senão ele "pisca"
  suavizacao: 0.15,      // peso do quadro novo na média móvel dos parâmetros
  ganhoMax: 8,           // HEURÍSTICA — teto de amplificação
  alvoMediana: 0.45,
};

export const CFG_MOVIMENTO = {
  alfaCurto: 0.05,       // ≈ 2 s a 10 Hz: o que se move
  alfaLongo: 1 / 3000,   // ≈ 5 min a 10 Hz: o que mudou e parou
  alfaDesloc: 0.05,      // ≈ 2 s: o fundo longo segue a deriva global de exposição
  k: 3.5,                // limiar = k · σ do ruído (σ por MAD)
  difMin: 10,            // piso do limiar em níveis de cinza (0–255)
  globalMax: 0.55,       // mais que isso do quadro mudou de uma vez = troca de luz, não movimento
  estabilizarMs: 1500,
  vizinhosMin: 3,        // pixel só fica se ≥ 3 dos 8 vizinhos também mudaram (tira o "chuvisco")
  areaMin: 0.0008,       // fração do quadro: ~46 px num quadro de 320×180
  areaMaxEstatico: 0.12, // mudança parada maior que isso é iluminação/cena, não objeto
};

/** RGBA (ImageData.data) → luminância 8 bits (BT.601, em inteiros). */
export function paraCinza(rgba, n, saida = new Uint8Array(n)) {
  for (let i = 0, j = 0; i < n; i++, j += 4) saida[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8;
  return saida;
}

/** Média (0–1) e percentis 2/50/98 (0–255) por histograma. */
export function estatisticasLuz(cinza) {
  const hist = new Uint32Array(256);
  let soma = 0;
  const n = cinza.length;
  for (let i = 0; i < n; i++) { hist[cinza[i]]++; soma += cinza[i]; }
  const perc = p => {
    const alvo = p * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= alvo) return v; }
    return 255;
  };
  return { media: n ? soma / n / 255 : 0, p02: perc(0.02), p50: perc(0.5), p98: perc(0.98) };
}

/** Curva de realce (tabela de 256 entradas) a partir dos percentis. Só clareia: gama ≤ 1. */
export function curvaRealce({ p02, p50, p98 }, { ganhoMax = CFG_LUZ.ganhoMax, alvoMediana = CFG_LUZ.alvoMediana } = {}) {
  const lo = Math.max(0, Math.min(250, p02));
  const hi = Math.min(255, Math.max(p98, lo + 255 / ganhoMax));
  const faixa = Math.max(1, hi - lo);
  const medN = Math.min(0.95, Math.max(0.02, (p50 - lo) / faixa));
  const gama = Math.min(1, Math.max(0.3, Math.log(alvoMediana) / Math.log(medN)));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const x = Math.min(1, Math.max(0, (v - lo) / faixa));
    lut[v] = Math.round(255 * Math.pow(x, gama));
  }
  return { lut, ganho: 255 / faixa, gama };
}

/** Aplica a curva nos canais RGB de um ImageData.data (in place). */
export function aplicarCurvaRGBA(rgba, lut) {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = lut[rgba[i]]; rgba[i + 1] = lut[rgba[i + 1]]; rgba[i + 2] = lut[rgba[i + 2]];
  }
  return rgba;
}

/** Aplica a curva numa imagem em tons de cinza (in place). */
export function aplicarCurvaCinza(cinza, lut) {
  for (let i = 0; i < cinza.length; i++) cinza[i] = lut[cinza[i]];
  return cinza;
}

/** Decide, com histerese e suavização, se a cena está escura e qual curva usar. */
export class MonitorLuz {
  constructor(cfg = {}) {
    this.cfg = { ...CFG_LUZ, ...cfg };
    this.reiniciar();
  }

  reiniciar() { this.media = null; this.escuro = false; this.p = null; this.curva = null; }

  atualizar(est) {
    const a = this.cfg.suavizacao;
    const mix = (velho, novo) => (velho == null ? novo : (1 - a) * velho + a * novo);
    this.media = mix(this.media, est.media);
    this.p = this.p
      ? { p02: mix(this.p.p02, est.p02), p50: mix(this.p.p50, est.p50), p98: mix(this.p.p98, est.p98) }
      : { p02: est.p02, p50: est.p50, p98: est.p98 };
    if (!this.escuro && this.media < this.cfg.escuroEntra) this.escuro = true;
    else if (this.escuro && this.media > this.cfg.escuroSai) this.escuro = false;
    this.curva = this.escuro ? curvaRealce(this.p, this.cfg) : null;
    return this.estado();
  }

  estado() {
    return { escuro: this.escuro, luz: this.media ?? null, ganho: this.curva ? this.curva.ganho : 1 };
  }
}

/* ── componentes conexos (4-vizinhança) sobre a máscara binária ── */
function componentes(mascara, w, h, areaMinPx, areaMaxPx, fila) {
  const blobs = [];
  const visto = new Uint8Array(w * h);
  for (let i0 = 0; i0 < mascara.length; i0++) {
    if (!mascara[i0] || visto[i0]) continue;
    let ini = 0, fim = 0, area = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    fila[fim++] = i0; visto[i0] = 1;
    while (ini < fim) {
      const i = fila[ini++];
      const x = i % w, y = (i / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mascara[i - 1] && !visto[i - 1]) { visto[i - 1] = 1; fila[fim++] = i - 1; }
      if (x < w - 1 && mascara[i + 1] && !visto[i + 1]) { visto[i + 1] = 1; fila[fim++] = i + 1; }
      if (y > 0 && mascara[i - w] && !visto[i - w]) { visto[i - w] = 1; fila[fim++] = i - w; }
      if (y < h - 1 && mascara[i + w] && !visto[i + w]) { visto[i + w] = 1; fila[fim++] = i + w; }
    }
    if (area >= areaMinPx && area <= areaMaxPx) {
      blobs.push({ x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h, area: area / (w * h) });
    }
  }
  return blobs.sort((a, b) => b.area - a.area);
}

/** Tira pixel isolado: fica só quem tem ≥ k vizinhos marcados (de 8). */
function limpar(mascara, w, h, k, saida) {
  saida.fill(0);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mascara[i]) continue;
      const n = mascara[i - w - 1] + mascara[i - w] + mascara[i - w + 1]
              + mascara[i - 1] + mascara[i + 1]
              + mascara[i + w - 1] + mascara[i + w] + mascara[i + w + 1];
      if (n >= k) saida[i] = 1;
    }
  }
  return saida;
}

/**
 * Mediana (com sinal) e MAD — mediana do desvio absoluto EM TORNO DA MEDIANA —
 * por histograma (−255..255). A MAD em torno de zero falharia justamente na troca
 * de luz: o quadro inteiro desloca, o "ruído" medido explode e o limiar engole
 * a própria troca.
 */
function medianaMad(dif, n) {
  const hist = new Uint32Array(511), hAbs = new Uint32Array(511);
  for (let i = 0; i < n; i++) hist[Math.round(dif[i]) + 255]++;
  const meio = n / 2;
  let acc = 0, med = 0;
  for (let v = 0; v < 511; v++) { acc += hist[v]; if (acc >= meio) { med = v - 255; break; } }
  for (let v = 0; v < 511; v++) if (hist[v]) hAbs[Math.abs(v - 255 - med)] += hist[v];
  acc = 0;
  let mad = 0;
  for (let v = 0; v < 511; v++) { acc += hAbs[v]; if (acc >= meio) { mad = v; break; } }
  return { med, mad };
}

export class DetectorMovimento {
  constructor(cfg = {}) {
    this.cfg = { ...CFG_MOVIMENTO, ...cfg };
    this.reiniciar();
  }

  reiniciar() {
    this.w = 0; this.h = 0;
    this.curto = null; this.longo = null;
    this.estabilizarAte = -Infinity;
    this.ultimo = { sigma: 0, limiar: 0, fracao: 0, trocaDeLuz: false };
  }

  #semear(cinza, w, h, t) {
    const n = w * h;
    this.w = w; this.h = h;
    this.curto = Float32Array.from(cinza);
    this.longo = Float32Array.from(cinza);
    this.difC = new Float32Array(n); this.difL = new Float32Array(n);
    this.mMov = new Uint8Array(n); this.mEst = new Uint8Array(n); this.mTmp = new Uint8Array(n);
    this.fila = new Int32Array(n);
    this.estabilizarAte = t + this.cfg.estabilizarMs;
  }

  /**
   * @param {Uint8Array} cinza  luminância w×h (no escuro, já com a curva de realce)
   * @returns {{movimento: Array, estaticos: Array, fracao: number, sigma: number, estabilizando: boolean, trocaDeLuz: boolean}}
   */
  processar(cinza, w, h, t, { difMin = null } = {}) {
    const vazio = extra => ({ movimento: [], estaticos: [], fracao: 0, sigma: this.ultimo.sigma, estabilizando: true, trocaDeLuz: false, ...extra });
    if (!this.curto || w !== this.w || h !== this.h) { this.#semear(cinza, w, h, t); return vazio(); }
    // piso do limiar proporcional à faixa de luz da cena: no escuro a imagem crua ocupa
    // poucos níveis de cinza e um piso fixo de 10 cegaria o sensor justamente onde ele importa
    const c = difMin == null ? this.cfg : { ...this.cfg, difMin }, n = w * h;
    const { curto, longo, difC, difL, mMov, mEst } = this;

    for (let i = 0; i < n; i++) { difC[i] = cinza[i] - curto[i]; difL[i] = cinza[i] - longo[i]; }
    // σ do ruído pela MAD: robusta porque o que se move é minoria do quadro
    const { med: deslocC, mad } = medianaMad(difC, n);
    const sigma = 1.4826 * Math.max(0.5, mad);
    const limiar = Math.max(c.difMin, c.k * sigma);
    // troca brusca de luz: o quadro INTEIRO deslocou de uma vez — refaz os fundos e espera assentar
    if (Math.abs(deslocC) > Math.max(c.difMin, 4 * sigma)) {
      curto.set(cinza); longo.set(cinza);
      this.estabilizarAte = t + c.estabilizarMs;
      this.ultimo = { sigma, limiar, fracao: 1, trocaDeLuz: true };
      return vazio({ fracao: 1, sigma, trocaDeLuz: true });
    }
    // deslocamento global lento (exposição automática) entre o quadro e o fundo longo
    const { med: deslocL } = medianaMad(difL, n);

    let moveis = 0;
    for (let i = 0; i < n; i++) {
      const dc = difC[i] - deslocC;   // compensa a pequena deriva global que ficou abaixo do gatilho de troca de luz
      const mv = (dc > limiar || dc < -limiar) ? 1 : 0;
      mMov[i] = mv; moveis += mv;
      const dl = difL[i] - deslocL;
      mEst[i] = !mv && (dl > limiar * 1.2 || dl < -limiar * 1.2) ? 1 : 0;
    }
    const fracao = moveis / n;
    this.ultimo = { sigma, limiar, fracao, trocaDeLuz: false };

    // mais da metade do quadro mudou sem deslocamento uniforme (algo cobriu a câmera,
    // farol varrendo a cena): sem fundo confiável — refaz e espera assentar
    if (fracao > c.globalMax) {
      curto.set(cinza); longo.set(cinza);
      this.estabilizarAte = t + c.estabilizarMs;
      this.ultimo.trocaDeLuz = true;
      return vazio({ fracao, sigma, trocaDeLuz: true });
    }

    // fundos: o curto acompanha tudo; o longo só aprende o LOCAL onde não há movimento,
    // mas acompanha a deriva GLOBAL de exposição em todo pixel (senão o entardecer
    // viraria "objeto parado" na cena inteira)
    const ac = c.alfaCurto, al = c.alfaLongo, ad = c.alfaDesloc * deslocL;
    for (let i = 0; i < n; i++) {
      curto[i] += ac * difC[i];
      if (!mMov[i]) longo[i] += al * (difL[i] - deslocL);
      longo[i] += ad;
    }

    if (t < this.estabilizarAte) return vazio({ fracao, sigma });

    const areaMinPx = Math.max(4, Math.round(c.areaMin * n));
    const movimento = componentes(limpar(mMov, w, h, c.vizinhosMin, this.mTmp), w, h, areaMinPx, n, this.fila);
    const estaticos = componentes(limpar(mEst, w, h, c.vizinhosMin, this.mTmp), w, h, areaMinPx, Math.round(c.areaMaxEstatico * n), this.fila);
    return { movimento, estaticos, fracao, sigma, estabilizando: false, trocaDeLuz: false };
  }

  /** Esquece no fundo longo uma região já tratada (objeto recolhido, mudança aceita). */
  absorver(caixa) {
    if (!this.longo) return;
    const { w, h } = this;
    const x0 = Math.max(0, Math.floor(caixa.x * w)), x1 = Math.min(w, Math.ceil((caixa.x + caixa.w) * w));
    const y0 = Math.max(0, Math.floor(caixa.y * h)), y1 = Math.min(h, Math.ceil((caixa.y + caixa.h) * h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.longo[y * w + x] = this.curto[y * w + x];
  }
}
