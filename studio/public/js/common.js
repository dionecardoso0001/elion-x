/* Utilidades compartilhadas. Regra de segurança do frontend: nenhum dado
   vindo da API ou do usuário é inserido como HTML — só textContent/atributos. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;

  const brl = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  /** Cria elemento com atributos e filhos (strings viram texto, nunca HTML). */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }

  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Erro ${r.status}`), { status: r.status, field: j.field });
    return j;
  }

  /* Botão magnético — quickTo caseiro: lerp em rAF, nunca animação por evento. */
  function magnetic(el, strength = 0.25) {
    if (reduced || !finePointer) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const loop = () => {
      x += (tx - x) * 0.18; y += (ty - y) * 0.18;
      el.style.setProperty('--bx', `${x.toFixed(2)}px`);
      el.style.setProperty('--by', `${y.toFixed(2)}px`);
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.1 ? requestAnimationFrame(loop) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - r.left - r.width / 2) * strength;
      ty = (e.clientY - r.top - r.height / 2) * strength;
      kick();
    });
    el.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
  }

  /* Inclinação 3D suave seguindo o mouse. */
  function tilt(el, max = 8) {
    if (reduced || !finePointer) return;
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--ry', '0deg'); el.style.setProperty('--rx', '0deg'); });
  }

  function reveal(root = document) {
    const els = root.querySelectorAll('.reveal:not(.in)');
    if (reduced || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e, i) => { e.style.transitionDelay = `${(i % 4) * 70}ms`; io.observe(e); });
  }

  const fmtDate = iso => iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  window.Studio = { h, api, brl, magnetic, tilt, reveal, fmtDate, reduced, finePointer };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.magnetic').forEach(el => magnetic(el));
    const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    reveal();
  });
})();
