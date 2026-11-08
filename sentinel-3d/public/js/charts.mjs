// Gráficos SVG leves (sem dependências). Segmentos sintéticos são desenhados tracejados e rotulados.

import { h } from './util.mjs';

const fmtHM = (t, long) => new Date(t).toLocaleString('pt-BR', long ? { day: '2-digit', month: '2-digit', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' });

export function lineChart(el, { series, unit = '', yMin, yMax, height = 190, empty = 'Sem dados no período.' }) {
  el.replaceChildren();
  const all = series.flatMap((s) => s.points.filter((p) => p.v != null));
  if (!all.length) { el.append(h('div', { class: 'empty', text: empty })); return; }
  const W = Math.max(280, el.clientWidth || 520), H = height, L = 44, R = 10, T = 10, B = 22;
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  let lo = yMin ?? Math.min(...all.map((p) => p.v)), hi = yMax ?? Math.max(...all.map((p) => p.v));
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; if (yMin == null) lo -= pad; if (yMax == null) hi += pad;
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const svg = h('svg', { svg: true, class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((s) => s.name).join(', ') });
  const axis = h('g', { svg: true, class: 'axis' });
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    axis.append(h('line', { svg: true, class: 'grid-line', x1: L, x2: W - R, y1: y(v), y2: y(v) }), h('text', { svg: true, x: L - 6, y: y(v) + 3, 'text-anchor': 'end', text: `${v.toFixed(Math.abs(hi - lo) < 10 ? 1 : 0)}` }));
  }
  const long = t1 - t0 > 86400000;
  for (let i = 0; i <= 4; i++) { const t = t0 + ((t1 - t0) * i) / 4; axis.append(h('text', { svg: true, x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle', text: fmtHM(t, long) })); }
  axis.append(h('text', { svg: true, x: 4, y: T + 4, text: unit }));
  svg.append(axis);
  for (const s of series) {
    let dSyn = '', dLive = '', prev = null;
    for (const p of s.points) {
      if (p.v == null) { prev = null; continue; }
      const seg = `${prev ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      if (p.synthetic) dSyn += seg; else dLive += (prev && prev.synthetic ? `M${x(prev.t).toFixed(1)},${y(prev.v).toFixed(1)}L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}` : seg);
      prev = p;
    }
    if (dSyn) svg.append(h('path', { svg: true, d: dSyn, fill: 'none', stroke: s.color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3', opacity: 0.55 }));
    if (dLive) svg.append(h('path', { svg: true, d: dLive, fill: 'none', stroke: s.color, 'stroke-width': 2 }));
  }
  const cursor = h('line', { svg: true, y1: T, y2: H - B, stroke: '#93a3b8', 'stroke-width': 1, opacity: 0 });
  svg.append(cursor);
  const wrap = h('div', { class: 'chart-wrap' }, svg);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  wrap.append(tip);
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const tx = t0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (t1 - t0);
    const rows = series.map((s) => { const p = nearest(s.points, tx); return p && `${s.name}: ${p.v == null ? '—' : p.v.toFixed(2)} ${unit}${p.synthetic ? ' (sintético)' : ''}`; }).filter(Boolean);
    const p0 = nearest(series[0].points, tx);
    if (!p0) return;
    cursor.setAttribute('x1', x(p0.t)); cursor.setAttribute('x2', x(p0.t)); cursor.setAttribute('opacity', 0.6);
    tip.hidden = false; tip.textContent = `${new Date(p0.t).toLocaleString('pt-BR')} · ${rows.join(' · ')}`;
    tip.style.left = `${Math.min(r.width - 220, Math.max(0, e.clientX - r.left + 10))}px`; tip.style.top = '4px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cursor.setAttribute('opacity', 0); });
  const hasSyn = all.some((p) => p.synthetic);
  el.append(wrap, h('div', { class: 'chart-legend' },
    series.map((s) => h('span', {}, h('i', { style: `background:${s.color}` }), s.name)),
    hasSyn ? h('span', {}, h('i', { style: 'background:repeating-linear-gradient(90deg,#93a3b8 0 4px,transparent 4px 7px)' }), 'tracejado = série sintética de demonstração') : null));
}

function nearest(points, t) {
  let best = null, bd = Infinity;
  for (const p of points) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } }
  return best;
}

export function barChart(el, items, { unit = '', empty = 'Sem registros no período.' } = {}) {
  el.replaceChildren();
  if (!items.length) { el.append(h('div', { class: 'empty', text: empty })); return; }
  const W = Math.max(280, el.clientWidth || 520), row = 24, H = items.length * row + 6, L = 150, R = 44;
  const max = Math.max(...items.map((i) => i.value), 1);
  const svg = h('svg', { svg: true, class: 'chart', viewBox: `0 0 ${W} ${H}`, style: `height:${H}px`, role: 'img', 'aria-label': items.map((i) => `${i.label}: ${i.value}`).join('; ') });
  items.forEach((it, k) => {
    const yy = k * row + 4;
    const w = ((W - L - R) * it.value) / max;
    svg.append(
      h('text', { svg: true, x: L - 8, y: yy + 14, 'text-anchor': 'end', fill: '#c9d4e2', 'font-size': 11.5, text: it.label }),
      h('rect', { svg: true, x: L, y: yy + 3, width: Math.max(2, w), height: row - 9, rx: 3, fill: it.color || '#22d3ee' }),
      h('text', { svg: true, x: L + w + 6, y: yy + 14, fill: '#93a3b8', 'font-size': 11, 'font-family': 'monospace', text: `${it.value}${unit}` }),
    );
  });
  el.append(svg);
}

export function timeBars(el, buckets, { bucketMs, since, until, color = '#f97316', empty = 'Nenhum incidente no período.' }) {
  el.replaceChildren();
  if (!buckets.length) { el.append(h('div', { class: 'empty', text: empty })); return; }
  const W = Math.max(280, el.clientWidth || 520), H = 150, L = 30, R = 8, T = 8, B = 22;
  const n = Math.max(1, Math.ceil((until - since) / bucketMs));
  const max = Math.max(...buckets.map((b) => b.n), 1);
  const bw = (W - L - R) / n;
  const svg = h('svg', { svg: true, class: 'chart', viewBox: `0 0 ${W} ${H}`, style: `height:${H}px`, role: 'img', 'aria-label': 'Incidentes ao longo do tempo' });
  const axis = h('g', { svg: true, class: 'axis' });
  for (let i = 0; i <= max; i += Math.max(1, Math.ceil(max / 4))) { const yy = T + (1 - i / max) * (H - T - B); axis.append(h('line', { svg: true, class: 'grid-line', x1: L, x2: W - R, y1: yy, y2: yy }), h('text', { svg: true, x: L - 5, y: yy + 3, 'text-anchor': 'end', text: i })); }
  axis.append(h('text', { svg: true, x: L, y: H - 6, text: fmtHM(since, until - since > 86400000) }), h('text', { svg: true, x: W - R, y: H - 6, 'text-anchor': 'end', text: fmtHM(until, until - since > 86400000) }));
  svg.append(axis);
  for (const b of buckets) {
    const i = Math.floor((b.t - since) / bucketMs);
    const bh = (b.n / max) * (H - T - B);
    svg.append(h('rect', { svg: true, x: L + i * bw + 1, y: H - B - bh, width: Math.max(2, bw - 2), height: bh, fill: color, rx: 2 }, h('title', { svg: true, text: `${new Date(b.t).toLocaleString('pt-BR')}: ${b.n}` })));
  }
  el.append(svg);
}

export function sparkline(points, color = '#22d3ee') {
  const vals = points.filter((p) => typeof p.v === 'number');
  const W = 300, H = 54;
  const svg = h('svg', { svg: true, class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (vals.length < 2) return svg;
  const lo = Math.min(...vals.map((p) => p.v)), hi = Math.max(...vals.map((p) => p.v));
  const t0 = vals[0].t, t1 = vals.at(-1).t;
  const d = vals.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${(H - 4 - ((p.v - lo) / Math.max(1e-9, hi - lo)) * (H - 8)).toFixed(1)}`).join('');
  svg.append(h('path', { svg: true, d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}
