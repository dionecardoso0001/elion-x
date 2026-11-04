/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA — HUD tático (canvas 2D sobre o vídeo)

   O canvas cobre o visor inteiro; o vídeo aparece por baixo com
   object-fit: contain. `ajustar()` recalcula o retângulo REAL da imagem
   dentro do visor (mesma conta do contain), e todo desenho passa por
   `px()` — que também resolve o espelhamento da câmera frontal. É o
   único lugar do sistema que sabe que a imagem pode estar espelhada.

   Desempenho: nada de shadowBlur (caro no celular). O "brilho" é traço
   largo translúcido + traço fino opaco. Cores vêm das variáveis CSS
   (--c-*), então tema e HUD nunca divergem.
   ═══════════════════════════════════════════════════════════════════════ */
import { rotulo, CLASSES } from './config.js';
import { trapezio } from './geometria.js';

const POSE = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30]];
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
const OLHO_D = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33];
const OLHO_E = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382, 362];
const LABIOS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];

const PORT = new Set(CLASSES.portateis), RISCO = new Set(CLASSES.risco);
const reduzMovimento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function lerCores() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    ok: v('--c-ok', '#39ff8b'), info: v('--c-info', '#00e5ff'), aviso: v('--c-aviso', '#ffb020'),
    critico: v('--c-critico', '#ff3355'), texto: v('--c-texto', '#d7ffe9'), fundo: v('--c-fundo', '#020604'),
  };
}
/** Aplica transparência a uma cor #rgb, #rrggbb ou rgb()/rgba(). */
const comAlfa = (cor, a) => {
  if (cor.startsWith('rgb')) {
    const [r, g, b] = cor.match(/[\d.]+/g);
    return `rgba(${r},${g},${b},${a})`;
  }
  const h = cor.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export class HUD {
  constructor(canvas, video) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.v = video;
    this.espelhar = false;
    this.cores = lerCores();
    this.dpr = 1; this.rect = { x: 0, y: 0, w: 1, h: 1 };
  }

  recarregarCores() { this.cores = lerCores(); }

  ajustar() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (W !== this.c.width || H !== this.c.height) { this.c.width = W; this.c.height = H; }
    this.dpr = dpr;
    const vw = this.v.videoWidth || 16, vh = this.v.videoHeight || 9;
    const s = Math.min(W / vw, H / vh);
    this.rect = { x: (W - vw * s) / 2, y: (H - vh * s) / 2, w: vw * s, h: vh * s };
  }

  px(nx, ny) {
    const x = this.espelhar ? 1 - nx : nx;
    return { x: this.rect.x + x * this.rect.w, y: this.rect.y + ny * this.rect.h };
  }

  caixa(b) {
    const a = this.px(b.x, b.y), z = this.px(b.x + b.w, b.y + b.h);
    return { x: Math.min(a.x, z.x), y: a.y, w: Math.abs(z.x - a.x), h: z.y - a.y };
  }

  /** Coordenada de tela (evento de ponteiro) → normalizada no quadro NÃO espelhado. */
  normalizar(clientX, clientY) {
    const r = this.c.getBoundingClientRect();
    const x = ((clientX - r.left) * this.dpr - this.rect.x) / this.rect.w;
    const y = ((clientY - r.top) * this.dpr - this.rect.y) / this.rect.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: this.espelhar ? 1 - x : x, y };
  }

  /* ─────────── primitivas ─────────── */
  #fonte(px, peso = 400) { this.g.font = `${peso} ${Math.round(px * this.dpr)}px "Share Tech Mono", ui-monospace, monospace`; }

  #colchetes(r, cor, tam = 12, larg = 2) {
    const g = this.g, d = this.dpr, k = Math.min(tam * d, r.w / 3, r.h / 3);
    g.strokeStyle = cor; g.lineWidth = larg * d;
    g.beginPath();
    g.moveTo(r.x, r.y + k); g.lineTo(r.x, r.y); g.lineTo(r.x + k, r.y);
    g.moveTo(r.x + r.w - k, r.y); g.lineTo(r.x + r.w, r.y); g.lineTo(r.x + r.w, r.y + k);
    g.moveTo(r.x + r.w, r.y + r.h - k); g.lineTo(r.x + r.w, r.y + r.h); g.lineTo(r.x + r.w - k, r.y + r.h);
    g.moveTo(r.x + k, r.y + r.h); g.lineTo(r.x, r.y + r.h); g.lineTo(r.x, r.y + r.h - k);
    g.stroke();
  }

  #placa(x, y, linhas, cor, alinhar = 'left') {
    const g = this.g, d = this.dpr;
    this.#fonte(11.5, 600);
    const pad = 4 * d, alt = 14 * d;
    const larg = Math.max(...linhas.map(l => g.measureText(l).width)) + pad * 2;
    let x0 = alinhar === 'right' ? x - larg : x;
    x0 = Math.max(this.rect.x + 2, Math.min(x0, this.rect.x + this.rect.w - larg - 2));
    let y0 = y - alt * linhas.length - 3 * d;
    if (y0 < this.rect.y + 2) y0 = y + 3 * d;
    g.fillStyle = 'rgba(2,8,5,0.78)';
    g.fillRect(x0, y0, larg, alt * linhas.length + 2 * d);
    g.fillStyle = cor; g.fillRect(x0, y0, 2 * d, alt * linhas.length + 2 * d);
    g.textBaseline = 'top';
    linhas.forEach((l, i) => { g.fillStyle = i === 0 ? cor : this.cores.texto; g.fillText(l, x0 + pad, y0 + 2 * d + i * alt); });
  }

  #polilinha(pts, cor, larg = 1.5, fechar = false) {
    if (pts.length < 2) return;
    const g = this.g, d = this.dpr;
    const caminho = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (fechar) g.closePath(); };
    g.strokeStyle = comAlfa(cor, 0.22); g.lineWidth = (larg + 4) * d; caminho(); g.stroke();
    g.strokeStyle = cor; g.lineWidth = larg * d; caminho(); g.stroke();
  }

  /* ─────────── quadro ─────────── */
  desenhar(e) {
    this.ajustar();
    const g = this.g, R = this.rect, d = this.dpr, C = this.cores;
    g.clearRect(0, 0, this.c.width, this.c.height);
    const agora = e.agora || performance.now();

    this.#moldura(e, agora);
    if (e.modo === 'sentinela') this.#sentinela(e, agora);
    else if (e.modo === 'motorista') this.#motorista(e, agora);
    else if (e.modo === 'transito') this.#transito(e, agora);

    // borda de alerta
    if (e.nivel === 'critico' || e.nivel === 'aviso') {
      const pulso = reduzMovimento() ? 1 : 0.55 + 0.45 * Math.sin(agora / 140);
      g.strokeStyle = comAlfa(e.nivel === 'critico' ? C.critico : C.aviso, 0.35 + 0.5 * pulso);
      g.lineWidth = (e.nivel === 'critico' ? 6 : 3) * d;
      g.strokeRect(R.x + 3 * d, R.y + 3 * d, R.w - 6 * d, R.h - 6 * d);
    }
  }

  #moldura(e, agora) {
    const g = this.g, R = this.rect, d = this.dpr, C = this.cores;
    const fraco = comAlfa(C.ok, 0.55);
    this.#colchetes({ x: R.x + 8 * d, y: R.y + 8 * d, w: R.w - 16 * d, h: R.h - 16 * d }, fraco, 26, 2);
    // réguas nas bordas
    g.strokeStyle = comAlfa(C.ok, 0.3); g.lineWidth = 1 * d;
    g.beginPath();
    for (let k = 1; k < 20; k++) {
      const x = R.x + (R.w * k) / 20, y = R.y + (R.h * k) / 20, L = (k % 5 ? 4 : 9) * d;
      g.moveTo(x, R.y + 2 * d); g.lineTo(x, R.y + 2 * d + L);
      g.moveTo(R.x + 2 * d, y); g.lineTo(R.x + 2 * d + L, y);
    }
    g.stroke();
    // retícula central
    const cx = R.x + R.w / 2, cy = R.y + R.h / 2, r = 14 * d;
    g.strokeStyle = comAlfa(C.ok, 0.4); g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.moveTo(cx - r * 1.8, cy); g.lineTo(cx - r * 0.5, cy); g.moveTo(cx + r * 0.5, cy); g.lineTo(cx + r * 1.8, cy);
    g.moveTo(cx, cy - r * 1.8); g.lineTo(cx, cy - r * 0.5); g.moveTo(cx, cy + r * 0.5); g.lineTo(cx, cy + r * 1.8);
    g.stroke();
    // varredura
    if (!reduzMovimento()) {
      const y = R.y + ((agora / 4200) % 1) * R.h;
      const grad = g.createLinearGradient(0, y - 40 * d, 0, y);
      grad.addColorStop(0, 'rgba(57,255,139,0)'); grad.addColorStop(1, 'rgba(57,255,139,0.10)');
      g.fillStyle = grad; g.fillRect(R.x, y - 40 * d, R.w, 40 * d);
    }
    // carimbos
    this.#fonte(11, 600); g.textBaseline = 'top'; g.fillStyle = comAlfa(C.ok, 0.85);
    const ts = new Date();
    g.fillText(`SENTINELA ▸ ${String(e.modo || '').toUpperCase()}  ${ts.toLocaleTimeString('pt-BR')}.${String(ts.getMilliseconds()).padStart(3, '0').slice(0, 2)}`, R.x + 16 * d, R.y + 16 * d);
    g.textBaseline = 'bottom';
    g.fillText(`FPS ${(e.fps || 0).toFixed(0)} · ALVOS ${e.trilhas?.length || 0} · INF ${(e.infMs || 0).toFixed(0)} ms`, R.x + 16 * d, R.y + R.h - 14 * d);
    if (e.gravando) {
      const pisca = reduzMovimento() || Math.floor(agora / 500) % 2 === 0;
      g.textBaseline = 'top'; g.fillStyle = C.critico;
      if (pisca) { g.beginPath(); g.arc(R.x + R.w - 70 * d, R.y + 22 * d, 5 * d, 0, Math.PI * 2); g.fill(); }
      g.fillText('REC', R.x + R.w - 60 * d, R.y + 16 * d);
    }
    if (e.campo) {   // sessão de calibração: fica gravado no vídeo e na captura também
      this.#fonte(11, 700); g.textBaseline = 'top'; g.textAlign = 'right'; g.fillStyle = C.aviso;
      g.fillText('● CAMPO', R.x + R.w - (e.gravando ? 90 : 16) * d, R.y + 16 * d);
      g.textAlign = 'left';
    }
    if (e.luz?.escuro) {   // visão noturna: quem olha precisa saber que a detecção roda na imagem clareada
      this.#fonte(11, 700); g.textBaseline = 'top'; g.textAlign = 'right'; g.fillStyle = C.aviso;
      g.fillText(`◐ VISÃO NOTURNA · LUZ ${Math.round((e.luz.luz || 0) * 100)}%${e.luz.realce ? ` · REALCE ×${(e.luz.ganho || 1).toFixed(1)}` : ''}`, R.x + R.w - 16 * d, R.y + 34 * d);
      g.textAlign = 'left';
    }
  }

  /* ─────────── MODO SENTINELA ─────────── */
  #sentinela(e, agora) {
    const g = this.g, d = this.dpr, C = this.cores, s = e.sentinela || {};
    // mapa de calor (modelo de normalidade)
    if (s.mostrarCalor && s.calor) {
      const [gx, gy] = s.grade;
      for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
        const v = s.calor[j * gx + i];
        if (v < 0.03) continue;
        const a = this.px(i / gx, j / gy), b = this.px((i + 1) / gx, (j + 1) / gy);
        g.fillStyle = v > 0.6 ? comAlfa(C.aviso, 0.08 + 0.22 * v) : comAlfa(C.ok, 0.05 + 0.25 * v);
        g.fillRect(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y);
      }
    }
    // zonas
    for (const z of s.zonas || []) {
      const pts = z.pontos.map(p => this.px(p.x, p.y));
      const cor = z.tipo === 'restrita' ? C.critico : C.aviso;
      const ocupada = (s.pessoas || []).some(p => p.zonas.includes(z.id));
      g.fillStyle = comAlfa(cor, ocupada ? 0.22 : 0.08);
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
      this.#polilinha(pts, cor, ocupada ? 2.5 : 1.5, true);
      const topo = pts.reduce((a, b) => (b.y < a.y ? b : a));
      this.#placa(topo.x, topo.y, [`ZONA ${z.nome}`, z.tipo === 'restrita' ? 'ACESSO RESTRITO' : 'MONITORADA'], cor);
    }
    // zona em edição
    if (s.zonaEdicao?.pontos?.length) {
      const pts = s.zonaEdicao.pontos.map(p => this.px(p.x, p.y));
      g.setLineDash([6 * d, 5 * d]); this.#polilinha(pts, C.info, 1.5, false); g.setLineDash([]);
      g.fillStyle = C.info;
      for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, 4 * d, 0, Math.PI * 2); g.fill(); }
    }
    // cursor do editor (teclado): retícula + aresta provisória até o último vértice
    if (s.zonaEdicao?.cursor) {
      const c = this.px(s.zonaEdicao.cursor.x, s.zonaEdicao.cursor.y), r = 9 * d;
      const ult = s.zonaEdicao.pontos.at(-1);
      if (ult) {
        const u = this.px(ult.x, ult.y);
        g.setLineDash([2 * d, 4 * d]); this.#polilinha([u, c], C.info, 1, false); g.setLineDash([]);
      }
      g.strokeStyle = C.info; g.lineWidth = 1.5 * d; g.beginPath();
      g.moveTo(c.x - 2 * r, c.y); g.lineTo(c.x - r / 2, c.y); g.moveTo(c.x + r / 2, c.y); g.lineTo(c.x + 2 * r, c.y);
      g.moveTo(c.x, c.y - 2 * r); g.lineTo(c.x, c.y - r / 2); g.moveTo(c.x, c.y + r / 2); g.lineTo(c.x, c.y + 2 * r);
      g.stroke();
      g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.stroke();
    }
    // sensor de movimento: só o que nenhum alvo detectado explica, e só no escuro
    if (s.escuro) {
      for (const m of s.movimentos || []) {
        if (m.explicado) continue;
        const r = this.caixa(m), cor = m.zona ? C.critico : C.aviso;
        g.setLineDash([5 * d, 4 * d]); g.strokeStyle = cor; g.lineWidth = 1.5 * d;
        g.strokeRect(r.x, r.y, r.w, r.h); g.setLineDash([]);
        this.#placa(r.x, r.y, [m.zona ? `MOVIMENTO · ZONA ${m.zona}` : 'MOVIMENTO NO ESCURO'], cor);
      }
    }
    // alteração parada (objeto deixado de qualquer tipo, pelo fundo duplo)
    for (const n of s.novos || []) {
      const r = this.caixa(n);
      const cor = n.estado === 'acompanhado' ? C.ok : C.aviso;
      const linhas = n.estado === 'acompanhado' ? [`OBJETO NOVO · DONO TGT-${n.dono}`]
        : n.estado === 'sem_dono' ? [`OBJETO NOVO · ${n.dono != null ? `TGT-${n.dono} SAIU` : 'SEM DONO'}`, `◆ ${Math.ceil(n.restanteS ?? 0)} s`]
        : [n.dono != null ? '▲ POSSÍVEL OBJETO ESQUECIDO' : '▲ ALTERAÇÃO PARADA'];
      this.#colchetes(r, cor, 12, 2);
      if (n.estado !== 'acompanhado') {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, raio = Math.max(r.w, r.h) * 0.75 + 8 * d;
        const frac = n.estado === 'alterado' ? 1 : 1 - (n.restanteS ?? 0) / (s.abandonoS || 30);
        g.strokeStyle = comAlfa(cor, 0.25); g.lineWidth = 3 * d;
        g.beginPath(); g.arc(cx, cy, raio, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = cor; g.beginPath(); g.arc(cx, cy, raio, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      }
      this.#placa(r.x, r.y, linhas, cor);
    }
    // esqueletos
    if (s.mostrarPoses) {
      for (const lm of s.poses || []) {
        g.strokeStyle = comAlfa(C.info, 0.85); g.lineWidth = 2 * d; g.beginPath();
        for (const [a, b] of POSE) {
          if ((lm[a]?.visibility ?? 1) < 0.4 || (lm[b]?.visibility ?? 1) < 0.4) continue;
          const p = this.px(lm[a].x, lm[a].y), q = this.px(lm[b].x, lm[b].y);
          g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
        }
        g.stroke();
      }
    }
    const infoP = new Map((s.pessoas || []).map(p => [p.id, p]));
    const infoO = new Map((s.objetos || []).map(o => [o.id, o]));
    const abandonoS = s.abandonoS || 30;
    for (const tr of e.trilhas || []) {
      if (tr.hits < 2) continue;
      const r = this.caixa(tr);
      let cor = tr.classe === 'person' ? C.info : RISCO.has(tr.classe) ? C.aviso : C.ok;
      const linhas = [`TGT-${String(tr.id).padStart(2, '0')} ${rotulo(tr.classe)} ${(tr.score * 100).toFixed(0)}%`];
      const p = infoP.get(tr.id), o = infoO.get(tr.id);
      if (p) {
        if (p.caido) { cor = C.critico; linhas.push('▲ QUEDA'); }
        else if (p.zonas.length && (s.zonas || []).some(z => z.tipo === 'restrita' && p.zonas.includes(z.id))) { cor = C.critico; linhas.push('▲ INTRUSÃO'); }
        else if (p.maosAlto) { cor = C.aviso; linhas.push('◆ MÃOS ERGUIDAS'); }
        else if (p.correndo) { cor = C.aviso; linhas.push('◆ CORRENDO'); }
        else if (p.atipico) { cor = C.aviso; linhas.push('◆ ATÍPICO'); }
      }
      if (o) {
        if (o.estado === 'abandonado') { cor = C.critico; linhas.push('▲ ABANDONADO'); }
        else if (o.estado === 'sem_dono') { cor = C.aviso; linhas.push(`◆ SEM DONO · ${Math.ceil(o.restanteS ?? 0)} s`); }
        else if (o.estado === 'estatico') linhas.push(o.dono != null ? `PARADO · DONO TGT-${o.dono}` : 'PARADO');
      }
      if (RISCO.has(tr.classe)) linhas.push('◆ OBJETO DE RISCO');
      // rastro
      if (tr.classe === 'person' && tr.historico?.length > 2) {
        const pts = tr.historico.filter(h => agora - h.t < 2500).map(h => this.px(h.cx, h.cy + h.h / 2));
        g.strokeStyle = comAlfa(cor, 0.35); g.lineWidth = 2 * d; g.beginPath();
        pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke();
      }
      this.#colchetes(r, cor, 14, 2);
      // contagem regressiva de abandono (anel)
      if (o && (o.estado === 'sem_dono' || o.estado === 'abandonado')) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, raio = Math.max(r.w, r.h) * 0.75 + 8 * d;
        const frac = o.estado === 'abandonado' ? 1 : 1 - (o.restanteS ?? 0) / abandonoS;
        g.strokeStyle = comAlfa(cor, 0.25); g.lineWidth = 3 * d;
        g.beginPath(); g.arc(cx, cy, raio, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = cor; g.beginPath(); g.arc(cx, cy, raio, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      }
      this.#placa(r.x, r.y, linhas, cor);
    }
  }

  /* ─────────── MODO MOTORISTA ─────────── */
  #motorista(e, agora) {
    const g = this.g, d = this.dpr, C = this.cores, R = this.rect, m = e.motorista?.metricas || {};
    const rosto = e.motorista?.rosto;
    const corEstado = m.fechado ? C.critico : (e.nivel === 'aviso' ? C.aviso : C.ok);
    if (rosto?.pontos) {
      const P = i => this.px(rosto.pontos[i].x, rosto.pontos[i].y);
      this.#polilinha(OVAL.map(P), comAlfa(C.ok, 0.6), 1, true);
      this.#polilinha(OLHO_D.map(P), corEstado, 1.5, true);
      this.#polilinha(OLHO_E.map(P), corEstado, 1.5, true);
      this.#polilinha(LABIOS.map(P), m.jawOpen > 0.55 ? C.aviso : comAlfa(C.info, 0.8), 1.2, true);
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const i of OVAL) { const p = P(i); x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
      const caixa = { x: x1 - 10 * d, y: y1 - 10 * d, w: x2 - x1 + 20 * d, h: y2 - y1 + 20 * d };
      this.#colchetes(caixa, corEstado, 16, 2);
      this.#placa(caixa.x, caixa.y, [`CONDUTOR ▸ ${m.fechado ? 'OLHOS FECHADOS' : 'OLHOS ABERTOS'}`,
        `EAR ${(m.ear ?? 0).toFixed(3)} / BASE ${(m.earBase ?? 0).toFixed(3)}`], corEstado);
    }
    // indicador de atitude (horizonte artificial da cabeça)
    const raio = Math.min(64 * d, R.w * 0.12), ax = R.x + R.w - raio - 18 * d, ay = R.y + raio + 34 * d;
    g.save();
    g.beginPath(); g.arc(ax, ay, raio, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(0,20,10,0.65)'; g.fillRect(ax - raio, ay - raio, raio * 2, raio * 2);
    const roll = ((this.espelhar ? -1 : 1) * (m.roll || 0) * Math.PI) / 180;
    const off = Math.max(-raio, Math.min(raio, (m.pitch || 0) * (raio / 45)));
    g.translate(ax, ay); g.rotate(roll);
    g.fillStyle = comAlfa(C.ok, 0.18); g.fillRect(-raio * 2, off, raio * 4, raio * 2);
    g.strokeStyle = C.ok; g.lineWidth = 2 * d; g.beginPath(); g.moveTo(-raio * 2, off); g.lineTo(raio * 2, off); g.stroke();
    g.strokeStyle = comAlfa(C.ok, 0.5); g.lineWidth = 1 * d;
    for (const k of [-20, -10, 10, 20]) { const y = off - k * (raio / 45); g.beginPath(); g.moveTo(-raio * 0.3, y); g.lineTo(raio * 0.3, y); g.stroke(); }
    g.restore();
    g.strokeStyle = comAlfa(C.ok, 0.7); g.lineWidth = 1.5 * d;
    g.beginPath(); g.arc(ax, ay, raio, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = C.aviso; g.lineWidth = 2.5 * d;
    g.beginPath(); g.moveTo(ax - raio * 0.45, ay); g.lineTo(ax - raio * 0.12, ay); g.lineTo(ax, ay + raio * 0.1); g.lineTo(ax + raio * 0.12, ay); g.lineTo(ax + raio * 0.45, ay); g.stroke();
    const yawX = ax + Math.max(-1, Math.min(1, ((this.espelhar ? -1 : 1) * (m.yaw || 0)) / 45)) * raio * 0.9;
    g.fillStyle = Math.abs(m.yaw || 0) >= 30 ? C.aviso : C.info;
    g.beginPath(); g.moveTo(yawX, ay - raio - 2 * d); g.lineTo(yawX - 5 * d, ay - raio - 10 * d); g.lineTo(yawX + 5 * d, ay - raio - 10 * d); g.fill();
    this.#fonte(10.5, 600); g.fillStyle = C.texto; g.textBaseline = 'top'; g.textAlign = 'center';
    g.fillText(`G ${fmt(m.yaw)}°  A ${fmt(m.pitch)}°  R ${fmt(m.roll)}°`, ax, ay + raio + 6 * d);
    g.textAlign = 'left';
    // barras de medição
    const bx = R.x + 16 * d, by = R.y + R.h - 110 * d, bw = Math.min(180 * d, R.w * 0.32);
    const barra = (k, rotuloTxt, v, max, limA, limC) => {
      const y = by + k * 22 * d, f = Math.max(0, Math.min(1, v / max));
      const cor = v >= limC ? C.critico : v >= limA ? C.aviso : C.ok;
      g.fillStyle = 'rgba(2,8,5,0.7)'; g.fillRect(bx, y, bw, 14 * d);
      g.fillStyle = comAlfa(cor, 0.8); g.fillRect(bx, y, bw * f, 14 * d);
      this.#fonte(10, 600); g.fillStyle = C.texto; g.textBaseline = 'middle';
      g.fillText(rotuloTxt, bx + 4 * d, y + 7 * d);
    };
    barra(0, `PERCLOS ${((m.perclos || 0) * 100).toFixed(1)}%`, m.perclos || 0, 0.2, 0.08, 0.12);
    barra(1, `PÁLPEBRA ${((m.fechamento || 0) * 100).toFixed(0)}%`, m.fechamento || 0, 1, 0.5, 0.8);
    barra(2, `FADIGA ${m.indiceFadiga ?? 0}/100`, m.indiceFadiga || 0, 100, 40, 70);
    barra(3, `OLHO FECHADO ${(m.duracaoFechado || 0).toFixed(1)} s`, m.duracaoFechado || 0, 2, 0.4, 1);
    // calibração
    if (m.calibrando) {
      const cx = R.x + R.w / 2, cy = R.y + R.h / 2, rr = Math.min(R.w, R.h) * 0.18;
      g.strokeStyle = comAlfa(C.info, 0.25); g.lineWidth = 6 * d; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = C.info; g.beginPath(); g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + (m.progressoCalibracao || 0) * Math.PI * 2); g.stroke();
      this.#fonte(13, 700); g.fillStyle = C.info; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('CALIBRANDO', cx, cy - 8 * d);
      this.#fonte(10.5, 600); g.fillStyle = C.texto; g.fillText('olhe para a via, postura normal', cx, cy + 12 * d);
      g.textAlign = 'left';
    }
    if (m.presente === false && !m.calibrando) {
      this.#fonte(16, 700); g.fillStyle = C.aviso; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`CONDUTOR FORA DE VISÃO · ${(m.ausenteS || 0).toFixed(1)} s`, R.x + R.w / 2, R.y + R.h / 2);
      g.textAlign = 'left';
    }
  }

  /* ─────────── MODO TRÂNSITO ─────────── */
  #transito(e, agora) {
    const g = this.g, d = this.dpr, C = this.cores, R = this.rect, t = e.transito || {};
    if (t.roi) {
      const pts = trapezio(t.roi).map(p => this.px(p.x, p.y));
      const grad = g.createLinearGradient(0, pts[0].y, 0, pts[2].y);
      grad.addColorStop(0, comAlfa(C.info, 0.02)); grad.addColorStop(1, comAlfa(C.info, 0.12));
      g.fillStyle = grad; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
      this.#polilinha([pts[0], pts[3]], comAlfa(C.info, 0.8), 1.5); this.#polilinha([pts[1], pts[2]], comAlfa(C.info, 0.8), 1.5);
      g.setLineDash([8 * d, 8 * d]); g.strokeStyle = comAlfa(C.info, 0.35); g.lineWidth = 1 * d;
      g.beginPath(); g.moveTo(R.x, pts[0].y); g.lineTo(R.x + R.w, pts[0].y); g.stroke(); g.setLineDash([]);
      this.#fonte(10, 600); g.fillStyle = comAlfa(C.info, 0.9); g.textBaseline = 'bottom';
      g.fillText('CORREDOR DO VEÍCULO', Math.min(pts[0].x, pts[1].x), pts[0].y - 4 * d);
    }
    const alvos = new Map((t.alvos || []).map(a => [a.id, a]));
    for (const tr of e.trilhas || []) {
      const a = alvos.get(tr.id);
      if (!a) continue;
      const r = this.caixa(tr);
      let cor = a.tipo === 'veiculo' ? C.ok : a.tipo === 'pedestre' ? C.info : C.aviso;
      if (a.risco === 'aviso') cor = C.aviso;
      if (a.risco === 'critico') cor = C.critico;
      const linhas = [`TGT-${String(tr.id).padStart(2, '0')} ${rotulo(tr.classe)}${a.z != null ? ` ~${a.z.toFixed(0)} m` : ''}`];
      if (isFinite(a.ttc) && a.ttc < 10) linhas.push(`TTC ${a.ttc.toFixed(1)} s`);
      if (a.lider) linhas.push('▸ VEÍCULO-LÍDER');
      this.#colchetes(r, cor, 14, a.lider ? 3 : 2);
      if (a.lider) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rr = Math.max(r.w, r.h) * 0.62 + 10 * d;
        const giro = reduzMovimento() ? 0 : (agora / 900) % (Math.PI * 2);
        g.strokeStyle = cor; g.lineWidth = 2 * d;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx, cy, rr, giro + (k * Math.PI) / 2, giro + (k * Math.PI) / 2 + 0.7); g.stroke(); }
      }
      this.#placa(r.x, r.y, linhas, cor);
    }
  }
}

const fmt = v => {
  if (v == null || !isFinite(v)) return '--';
  const n = Math.round(v) || 0;   // "|| 0" elimina o −0
  return `${n > 0 ? '+' : ''}${n}`;
};
