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

  /* Reconverte a foto para JPEG via canvas: apaga EXIF/GPS, converte HEIC
     (onde o navegador decodifica) e reduz para no máximo 2560 px. */
  async function prepareImage(file, max = 2560) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { throw new Error(`Não consegui ler "${file.name}". Envie em JPG ou PNG.`); }
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new Error(`Falha ao processar "${file.name}".`);
    return blob;
  }

  /* PUT binário com barra de progresso (fetch não informa progresso de envio). */
  function upload(url, blob, { token, label, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      if (token) x.setRequestHeader('Authorization', `Bearer ${token}`);
      x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      x.setRequestHeader('X-File-Label', encodeURIComponent(String(label || 'Arquivo').slice(0, 80)));
      x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let j = {}; try { j = JSON.parse(x.responseText); } catch { /* vazio */ }
        x.status < 300 ? resolve(j) : reject(Object.assign(new Error(j.error || `Erro ${x.status}`), { status: x.status }));
      };
      x.onerror = () => reject(new Error('Falha de conexão durante o envio.'));
      x.send(blob);
    });
  }

  /* ── Ícones 3D: flutuam sempre; com o mouse, inclinam e reluzem ── */
  const ICONS = {
    'vender-produto': ['webp', '120, 110, 255'], autopromocao: ['webp', '255, 190, 80'], lancamento: ['webp', '200, 110, 255'],
    evento: ['webp', '255, 90, 200'], institucional: ['webp', '80, 150, 255'],
    foto: ['svg', '90, 150, 255'], video: ['svg', '170, 90, 255'], kit: ['svg', '230, 90, 230'],
    vertical: ['svg', '80, 200, 255'], quadrado: ['svg', '150, 110, 255'], horizontal: ['svg', '80, 170, 255'],
  };
  let iconBase = '/assets/icons/';
  let iconCount = 0;
  function icon3d(name, { size = 56 } = {}) {
    const [ext, glow] = ICONS[name] || ICONS.foto;
    const src = `${iconBase}${name}.${ext}`;
    const body = h('span', { class: 'i3-body' }, h('img', { src, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' }), h('span', { class: 'i3-glare' }), h('span', { class: 'i3-shine' }));
    const el = h('span', { class: 'icon3d', 'aria-hidden': 'true' }, body);
    el.style.setProperty('--size', `${size}px`);
    el.style.setProperty('--glow', glow);
    // URL absoluta: url() relativo dentro de variável CSS seria resolvido a partir do .css
    el.style.setProperty('--mask', `url("${new URL(src, document.baseURI).href}")`);
    el.style.setProperty('--delay', `${-(iconCount++ % 7) * 0.6}s`); // cada ícone flutua num tempo diferente
    return el;
  }

  /* Um único ouvinte para todos os ícones: inclinação e reflexo seguem o mouse dentro do "host". */
  function wireIconHosts() {
    if (reduced || !finePointer) return;
    let raf = 0, last = null;
    document.addEventListener('pointermove', e => {
      last = e;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        const host = last.target.closest?.('.icon-host');
        if (!host) return;
        const r = host.getBoundingClientRect();
        const px = (last.clientX - r.left) / r.width, py = (last.clientY - r.top) / r.height;
        host.querySelectorAll('.icon3d').forEach(i => {
          i.style.setProperty('--ry', `${((px - 0.5) * 34).toFixed(1)}deg`);
          i.style.setProperty('--rx', `${((0.5 - py) * 28).toFixed(1)}deg`);
          i.style.setProperty('--gx', `${(px * 100).toFixed(0)}%`);
          i.style.setProperty('--gy', `${(py * 100).toFixed(0)}%`);
        });
      });
    }, { passive: true });
    document.addEventListener('pointerout', e => {
      const host = e.target.closest?.('.icon-host');
      if (!host || host.contains(e.relatedTarget)) return;
      host.querySelectorAll('.icon3d').forEach(i => { i.style.setProperty('--ry', '0deg'); i.style.setProperty('--rx', '0deg'); });
    });
  }

  const fmtSize = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

  window.Studio = { h, api, brl, magnetic, tilt, reveal, fmtDate, fmtSize, prepareImage, upload, icon3d, setIconBase: b => { iconBase = b; }, reduced, finePointer };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.magnetic').forEach(el => magnetic(el));
    wireIconHosts();
    const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();
    reveal();
  });
})();
