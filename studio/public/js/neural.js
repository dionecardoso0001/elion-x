/* Rede neural do hero — canvas 2D leve, ecoando o cérebro da logomarca.
   Pausa fora da tela e com a aba oculta; não existe com movimento reduzido. */
(() => {
  const canvas = document.getElementById('neural');
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  const COLORS = ['63,216,255', '139,92,246', '47,107,255', '255,79,216'];
  let w = 0, h = 0, dpr = 1, nodes = [], visible = true, raf = 0;
  const mouse = { x: -9999, y: -9999 };

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, (w * h) / 16000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.8 + 0.8, c: COLORS[(Math.random() * COLORS.length) | 0],
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    const LINK = 130;
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
      const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 140 * 140) { n.x += dx * 0.012; n.y += dy * 0.012; } // repulsão suave do cursor
    }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < LINK) {
          ctx.strokeStyle = `rgba(${a.c},${(1 - d / LINK) * 0.35})`;
          ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const n of nodes) {
      ctx.fillStyle = `rgba(${n.c},.95)`;
      ctx.shadowColor = `rgba(${n.c},1)`; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    raf = visible && !document.hidden ? requestAnimationFrame(frame) : 0;
  }

  const start = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame); };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }).observe(canvas);
  document.addEventListener('visibilitychange', start);
  addEventListener('resize', () => { resize(); }, { passive: true });
  canvas.parentElement.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  });
  canvas.parentElement.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
  resize(); start();
})();
