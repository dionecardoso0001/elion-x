// NÍVEL 2 — Análise estatística: linha de base por dispositivo, anomalias e tendência.
// Nada aqui "prevê" sem dados suficientes: cada função declara n mínimo e devolve null se faltar.

import { TYPES } from '../domain/catalog.mjs';

export const MIN_BASELINE_SAMPLES = 30;
export const Z_THRESHOLD = 4;

export function meanStd(xs) {
  const n = xs.length;
  if (!n) return { n: 0, mean: NaN, std: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  return { n, mean, std: Math.sqrt(variance) };
}

/** Anomalias estatísticas nas métricas marcadas com stat:true. history exclui a leitura atual. */
export function detectAnomalies(type, history, current) {
  const out = [];
  for (const m of TYPES[type].metrics) {
    if (!m.stat) continue;
    const v = current?.[m.key];
    if (typeof v !== 'number') continue;
    const xs = history.map((h) => h.values[m.key]).filter((x) => typeof x === 'number');
    if (xs.length < MIN_BASELINE_SAMPLES) continue;
    const { n, mean, std } = meanStd(xs);
    const floor = Math.max(std, Math.abs(mean) * 0.02, 1e-6); // evita z infinito em séries quase constantes
    const z = (v - mean) / floor;
    if (Math.abs(z) > Z_THRESHOLD) {
      out.push({
        code: `stat:${m.key}`, level: 'degraded', metric: m.key, value: v, statistical: true,
        text: `Anomalia estatística em ${m.label}: ${round(v)}${m.unit ? ' ' + m.unit : ''} vs linha de base ${round(mean)} ± ${round(std)} (z = ${round(z)}, n = ${n})`,
      });
    }
  }
  return out;
}

/** Regressão linear simples. points: [{t (ms), v}] */
export function linearTrend(points) {
  const n = points.length;
  if (n < 10) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 86400000); // dias
  const ys = points.map((p) => p.v);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (sxx === 0 || syy === 0) return { n, slopePerDay: 0, r2: 0 };
  const slope = sxy / sxx;
  const r2 = (sxy * sxy) / (sxx * syy);
  const intercept = my - slope * mx;
  return { n, slopePerDay: slope, r2, intercept, t0, lastX: xs[n - 1] };
}

/**
 * Projeção de cruzamento de limiar — só é emitida com n ≥ 10, R² ≥ 0,6 e tendência na direção do limiar.
 * Retorna null quando a evidência não sustenta uma projeção.
 */
export function projectCrossing(points, threshold, direction = 'down') {
  const tr = linearTrend(points);
  if (!tr || tr.r2 < 0.6) return tr ? { ...tr, projection: null, reason: 'R² < 0,6: tendência não sustentada pelos dados' } : null;
  const goingToward = direction === 'down' ? tr.slopePerDay < 0 : tr.slopePerDay > 0;
  if (!goingToward) return { ...tr, projection: null, reason: 'Sem tendência na direção do limiar' };
  const current = tr.intercept + tr.slopePerDay * tr.lastX;
  const daysLeft = (threshold - current) / tr.slopePerDay;
  return { ...tr, current, projection: daysLeft > 0 ? { daysToThreshold: daysLeft, threshold } : { daysToThreshold: 0, threshold } };
}

const round = (x) => Math.round(x * 100) / 100;
