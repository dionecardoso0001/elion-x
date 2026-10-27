// Planta 2D em SVG: alternativa acessível (teclado/leitor de tela) e fallback sem WebGL.

import { h } from '../util.mjs';

const COLORS = { ok: '#22c55e', degraded: '#eab308', critical: '#ef4444', offline: '#9ca3af', maintenance: '#3b82f6', unknown: '#a855f7' };
const SHAPES = { // forma distinta por estado (não depende só de cor)
  ok: (x, y) => h('circle', { svg: true, cx: x, cy: y, r: 0.28 }),
  degraded: (x, y) => h('path', { svg: true, d: `M${x} ${y - 0.34}L${x + 0.32} ${y + 0.24}L${x - 0.32} ${y + 0.24}Z` }),
  critical: (x, y) => h('path', { svg: true, d: `M${x} ${y - 0.36}L${x + 0.36} ${y}L${x} ${y + 0.36}L${x - 0.36} ${y}Z` }),
  offline: (x, y) => h('circle', { svg: true, cx: x, cy: y, r: 0.24, 'fill-opacity': 0.15, 'stroke-width': 0.1 }),
  maintenance: (x, y) => h('rect', { svg: true, x: x - 0.25, y: y - 0.25, width: 0.5, height: 0.5 }),
  unknown: (x, y) => h('circle', { svg: true, cx: x, cy: y, r: 0.28, 'stroke-dasharray': '0.12 0.08', 'fill-opacity': 0.25, 'stroke-width': 0.08 }),
};

export class Plan2D {
  constructor(el, { onSelect, statusLabels }) { this.el = el; this.onSelect = onSelect; this.statusLabels = statusLabels; this.nodes = new Map(); }

  build(layout, devices, { hideRestricted }) {
    const W = layout.bounds.x, D = layout.bounds.z;
    const svg = h('svg', { svg: true, viewBox: `-0.6 -0.6 ${W + 1.2} ${D + 1.8}`, role: 'group', 'aria-label': 'Planta 2D da agência demonstrativa' });
    for (const r of layout.rooms) {
      const locked = hideRestricted && r.restricted;
      svg.append(h('rect', { svg: true, x: r.x0, y: r.z0, width: r.x1 - r.x0, height: r.z1 - r.z0, fill: locked ? '#0b1a33' : r.restricted ? '#101a26' : '#121a24', stroke: '#2a3a4e', 'stroke-width': 0.04 }));
      svg.append(h('text', { svg: true, x: (r.x0 + r.x1) / 2, y: r.z0 + 0.7, 'text-anchor': 'middle', 'font-size': 0.5, fill: locked ? '#66768b' : '#93a3b8', text: locked ? `${r.name} (restrito)` : r.name }));
    }
    for (const w of layout.walls) {
      svg.append(h('line', { svg: true, x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], stroke: w.kind === 'glass' ? '#4fb3ff' : w.kind === 'low' ? '#8b6a4a' : '#d6d1c7', 'stroke-width': w.kind === 'wall' ? 0.15 : 0.08 }));
      for (const d of w.doors || []) {
        const horiz = w.a[1] === w.b[1];
        svg.append(h('line', { svg: true, x1: horiz ? d.at - d.w / 2 : w.a[0], y1: horiz ? w.a[1] : d.at - d.w / 2, x2: horiz ? d.at + d.w / 2 : w.a[0], y2: horiz ? w.a[1] : d.at + d.w / 2, stroke: '#121a24', 'stroke-width': 0.2 }));
      }
    }
    svg.append(h('text', { svg: true, x: W / 2, y: D + 1.0, 'text-anchor': 'middle', 'font-size': 0.45, fill: '#66768b', text: 'PLANTA DEMONSTRATIVA FICTÍCIA — SEM ESCALA OFICIAL' }));
    this.layer = h('g', { svg: true });
    svg.append(this.layer);
    for (const d of devices) {
      const g = h('g', { svg: true, class: 'dev', tabindex: 0, role: 'button', dataset: { id: d.id } });
      g.addEventListener('click', () => this.onSelect(d.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onSelect(d.id); } });
      this.layer.append(g);
      this.nodes.set(d.id, { g, d, status: null });
    }
    this.el.replaceChildren(svg);
  }

  setStates(states) {
    for (const s of states) {
      const n = this.nodes.get(s.id);
      if (!n || n.status === s.status) continue;
      n.status = s.status;
      const [x, , z] = n.d.pos;
      const shape = SHAPES[s.status](x, z);
      shape.setAttribute('fill', COLORS[s.status]); shape.setAttribute('stroke', COLORS[s.status]);
      n.g.replaceChildren(h('title', { svg: true, text: `${n.d.id} — ${n.d.name}: ${this.statusLabels[s.status]}` }), shape);
      n.g.setAttribute('aria-label', `${n.d.id}, ${n.d.name}, ${this.statusLabels[s.status]}`);
    }
    if (this.selected) this.select(this.selected);
  }

  select(id) {
    this.selected = id;
    for (const [k, n] of this.nodes) {
      const shape = n.g.querySelector('circle,path,rect');
      if (!shape) continue;
      shape.setAttribute('stroke', k === id ? '#22d3ee' : COLORS[n.status]);
      shape.setAttribute('stroke-width', k === id ? 0.14 : (n.status === 'offline' || n.status === 'unknown' ? 0.08 : 0));
    }
  }
}
