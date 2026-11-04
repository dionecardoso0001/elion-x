/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — geometria e estatística (ESM puro, sem DOM)

   Convenção única do sistema inteiro: coordenadas NORMALIZADAS [0,1]
   no quadro NÃO espelhado da câmera, origem no canto superior esquerdo,
   y para baixo. Caixa = { x, y, w, h } (canto superior esquerdo).
   Espelhar é problema exclusivo de quem DESENHA (hud.js) — nenhuma
   decisão de alarme depende de como a imagem é mostrada.
   ═══════════════════════════════════════════════════════════════════════ */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const graus = rad => (rad * 180) / Math.PI;
export const radianos = g => (g * Math.PI) / 180;

export const centro = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
/** Ponto de apoio no chão (meio da borda inferior) — é ele que "pisa" numa zona. */
export const base = b => ({ x: b.x + b.w / 2, y: b.y + b.h });
export const distancia = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Intersecção sobre união de duas caixas. */
export function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const uniao = a.w * a.h + b.w * b.h - inter;
  return uniao > 0 ? inter / uniao : 0;
}

/** Ponto dentro de polígono (ray casting, regra par-ímpar). poly = [{x,y}, ...] */
export function pontoNoPoligono(p, poly) {
  if (!poly || poly.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const cruza = (a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

/** Trapézio do corredor do veículo (modo trânsito) como polígono. */
export function trapezio({ topoY, baseY, larguraTopo, larguraBase, centroX = 0.5 }) {
  return [
    { x: centroX - larguraTopo / 2, y: topoY },
    { x: centroX + larguraTopo / 2, y: topoY },
    { x: centroX + larguraBase / 2, y: baseY },
    { x: centroX - larguraBase / 2, y: baseY },
  ];
}

/** Meia-largura do trapézio na altura y (para medir o quão perto do corredor algo está). */
export function meiaLarguraEm(roi, y) {
  const t = clamp((y - roi.topoY) / Math.max(1e-6, roi.baseY - roi.topoY), 0, 1);
  return lerp(roi.larguraTopo, roi.larguraBase, t) / 2;
}

export function media(v) {
  if (!v.length) return 0;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

export function desvioPadrao(v) {
  if (v.length < 2) return 0;
  const m = media(v);
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / (v.length - 1));
}

export function mediana(v) {
  if (!v.length) return 0;
  const o = [...v].sort((a, b) => a - b);
  const k = o.length >> 1;
  return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2;
}

/**
 * Regressão linear por mínimos quadrados sobre pares [x, y].
 * Devolve inclinação, intercepto e R² — o R² é o que separa uma
 * tendência real (carro se aproximando) de tremor do detector.
 */
export function regressaoLinear(pares) {
  const n = pares.length;
  if (n < 2) return { inclinacao: 0, intercepto: n ? pares[0][1] : 0, r2: 0, n };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pares) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return { inclinacao: 0, intercepto: sy / n, r2: 0, n };
  const inclinacao = (n * sxy - sx * sy) / den;
  const intercepto = (sy - inclinacao * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (const [x, y] of pares) { const e = y - (inclinacao * x + intercepto); ssRes += e * e; }
  const r2 = ssTot > 1e-12 ? clamp(1 - ssRes / ssTot, 0, 1) : 0;
  return { inclinacao, intercepto, r2, n };
}

/* ── vetores 3D (pose da cabeça) ── */
export const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const cruz3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export function normaliza3(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/** Caixa envolvente de um conjunto de pontos normalizados (ex.: esqueleto da pose). */
export function caixaDePontos(pts, visMin = 0.3) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
  for (const p of pts) {
    if (!p || (p.visibility != null && p.visibility < visMin)) continue;
    if (p.x < x1) x1 = p.x; if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x; if (p.y > y2) y2 = p.y;
    n++;
  }
  if (n < 3) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Janela deslizante por tempo: mantém só amostras com t >= agora - janelaMs. */
export function aparar(lista, agora, janelaMs) {
  let i = 0;
  while (i < lista.length && agora - lista[i].t > janelaMs) i++;
  if (i) lista.splice(0, i);
  return lista;
}
