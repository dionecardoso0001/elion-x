/* Abertura com vídeo guiado pela rolagem (técnica de sequência de quadros).
   A seção fica fixa na tela enquanto a rolagem avança/volta os 150 quadros
   num <canvas>. Desenhar imagens é muito mais suave do que mudar
   video.currentTime, que trava entre quadros-chave.

   - Primeiro quadro na hora; depois quadros espaçados (prévia grosseira) e
     por fim todos — se a rolagem chegar antes, usa o quadro carregado mais perto.
   - Só trabalha quando a seção está visível e só redesenha se o quadro mudou.
   - Sem JS ou com movimento reduzido: fica o <video> comum com controles. */
(() => {
  const root = document.getElementById('intro');
  if (!root) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // mantém o vídeo comum

  const base = root.dataset.frames;
  const count = Number(root.dataset.count) || 0;
  const fg = root.querySelector('.intro-fg');
  const bg = root.querySelector('.intro-bg');
  const fctx = fg.getContext('2d');
  const bctx = bg.getContext('2d');
  const caps = [...root.querySelectorAll('.intro-cap')].map(el => ({ el, from: +el.dataset.from, to: +el.dataset.to }));
  const bar = root.querySelector('.intro-progress i');
  const hint = root.querySelector('.intro-hint');

  root.classList.add('intro--scrub');

  const frames = new Array(count);
  const loaded = new Uint8Array(count);
  const src = i => `${base}${String(i + 1).padStart(3, '0')}.webp`;

  function load(i) {
    if (frames[i]) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { loaded[i] = 1; if (i === shown || shown < 0) requestDraw(true); };
    img.src = src(i);
    frames[i] = img;
  }

  // Ordem de carga: 1º quadro, depois a cada 16, 8, 4, 2 e 1 — a rolagem fica "assistível" cedo.
  function preload() {
    load(0);
    const order = [];
    for (const step of [16, 8, 4, 2, 1]) for (let i = 0; i < count; i += step) order.push(i);
    let k = 0;
    const pump = () => { for (let n = 0; n < 6 && k < order.length; n++) load(order[k++]); if (k < order.length) setTimeout(pump, 40); };
    pump();
  }

  function nearestLoaded(i) {
    if (loaded[i]) return i;
    for (let d = 1; d < count; d++) {
      if (i - d >= 0 && loaded[i - d]) return i - d;
      if (i + d < count && loaded[i + d]) return i + d;
    }
    return -1;
  }

  /* ── tamanho do canvas ── */
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = root.querySelector('.intro-stage').clientWidth;
    H = root.querySelector('.intro-stage').clientHeight;
    fg.width = Math.round(W * dpr); fg.height = Math.round(H * dpr);
    // Fundo desfocado em baixa resolução: o blur do CSS (GPU) faz o resto, sem custo por quadro.
    bg.width = 72; bg.height = Math.max(1, Math.round(72 * H / W));
    requestDraw(true);
  }

  function draw(i) {
    const img = frames[i];
    if (!img || !img.naturalWidth) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    // Retrato (celular): cobre a tela. Paisagem: altura total, centralizado, e o fundo desfocado preenche as laterais.
    const portrait = W / H < 0.8;
    const scale = portrait ? Math.max(W / iw, H / ih) : H / ih;
    const dw = iw * scale * dpr, dh = ih * scale * dpr;
    fctx.clearRect(0, 0, fg.width, fg.height);
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(img, (fg.width - dw) / 2, (fg.height - dh) / 2, dw, dh);
    const bs = Math.max(bg.width / iw, bg.height / ih);
    bctx.drawImage(img, (bg.width - iw * bs) / 2, (bg.height - ih * bs) / 2, iw * bs, ih * bs);
  }

  /* ── rolagem → progresso (com leve inércia) ── */
  let target = 0, current = 0, shown = -1, raf = 0, visible = true, force = false;

  function readScroll() {
    const r = root.getBoundingClientRect();
    const total = root.offsetHeight - H;
    target = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
  }

  function requestDraw(f) { force = force || f; if (!raf && visible) raf = requestAnimationFrame(tick); }

  function tick() {
    raf = 0;
    current += (target - current) * 0.22;
    if (Math.abs(target - current) < 0.0005) current = target;
    const idx = nearestLoaded(Math.round(current * (count - 1)));
    if (idx >= 0 && (idx !== shown || force)) { draw(idx); shown = idx; force = false; }

    for (const c of caps) {
      const fadeIn = Math.min(1, Math.max(0, (current - c.from) / 0.05));
      const fadeOut = Math.min(1, Math.max(0, (c.to - current) / 0.05));
      const o = Math.min(fadeIn, fadeOut);
      c.el.style.setProperty('--o', o.toFixed(3));
      c.el.classList.toggle('vis', o > 0.01);
      c.el.classList.toggle('on', o > 0.5); // só aceita clique quando está bem visível
    }
    bar.style.transform = `scaleX(${current.toFixed(4)})`;
    hint.style.opacity = String(Math.max(0, 1 - current / 0.04));

    if (current !== target) raf = requestAnimationFrame(tick);
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) { readScroll(); requestDraw(true); } }, { rootMargin: '100px 0px' }).observe(root);
  addEventListener('scroll', () => { readScroll(); requestDraw(false); }, { passive: true });
  addEventListener('resize', () => { resize(); readScroll(); }, { passive: true });

  resize();
  readScroll();
  current = target;
  preload();
})();
