# Motion, Scroll e Mouse — Receitas de Produção

Índice: 1. Setup Lenis + GSAP · 2. Reveal e split text · 3. Pin + scrub · 4. Scroll horizontal · 5. Parallax · 6. Cursor magnético · 7. Tilt 3D · 8. Transições de página · 9. Preloader · 10. React/Next.js · 11. Acessibilidade e desempenho · 12. Debug

Versões usadas nos exemplos (fixe exatas; confira atualizações no npm): `gsap@3.12.5`, `lenis@1.1.13`. Desde 2025 a GreenSock (adquirida pela Webflow) liberou todos os plugins (incluindo SplitText, MorphSVG) gratuitamente na versão 3.13+; se usar SplitText oficial, confirme a versão no npm. Os exemplos abaixo usam um split próprio para não depender disso.

## 1. Setup Lenis + GSAP (um único relógio)

```js
gsap.registerPlugin(ScrollTrigger);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

let lenis = null;
if (!reduce) {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
// Âncoras continuam funcionando:
document.querySelectorAll('a[href^="#"]').forEach(a =>
  a.addEventListener('click', e => {
    const el = document.querySelector(a.getAttribute('href'));
    if (!el) return;
    e.preventDefault();
    lenis ? lenis.scrollTo(el, { offset: -80 }) : el.scrollIntoView({ behavior: 'auto' });
  }));
```
CSS obrigatório do Lenis: `html.lenis, html.lenis body { height: auto; } .lenis.lenis-smooth { scroll-behavior: auto !important; }`. Elementos com scroll interno: `data-lenis-prevent`.

## 2. Reveal e split text

```js
function split(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute('aria-label', el.textContent.trim());
  el.innerHTML = words.map(w =>
    `<span class="w" aria-hidden="true"><span class="wi">${w.replace(/[<>&]/g, '')}</span></span>`).join(' ');
  return el.querySelectorAll('.wi');
}
document.querySelectorAll('[data-split]').forEach(el => {
  gsap.from(split(el), {
    yPercent: 110, duration: 1, ease: 'expo.out', stagger: 0.04,
    scrollTrigger: { trigger: el, start: 'top 85%' }
  });
});
```
CSS: `.w{display:inline-block;overflow:hidden;vertical-align:top}.wi{display:inline-block}`. Sanitize o texto (ou use `textContent`) — split com `innerHTML` de conteúdo de CMS é vetor de XSS.

Reveal de imagem com clip-path:
```js
gsap.fromTo('[data-reveal]', { clipPath: 'inset(100% 0 0 0)' },
  { clipPath: 'inset(0% 0 0 0)', ease: 'power4.inOut', duration: 1.4,
    scrollTrigger: { trigger: '[data-reveal]', start: 'top 80%' } });
```

## 3. Pin + scrub (storytelling)

```js
const tl = gsap.timeline({
  scrollTrigger: { trigger: '.story', start: 'top top', end: '+=200%', scrub: 1, pin: true, anticipatePin: 1 }
});
tl.from('.story h2', { opacity: 0, y: 60 })
  .to('.story .device', { rotateY: -25, scale: 1.15 }, '<')
  .from('.story .feature', { opacity: 0, x: 80, stagger: 0.3 });
```
`scrub: 1` suaviza 1 s; `scrub: true` amarra 1:1. `end: '+=200%'` = duas alturas de viewport de rolagem. Evite pin dentro de containers com `transform` (quebra `position: fixed`).

## 4. Scroll horizontal

```js
const track = document.querySelector('.h-track');
gsap.to(track, {
  x: () => -(track.scrollWidth - innerWidth), ease: 'none',
  scrollTrigger: { trigger: '.h-wrap', pin: true, scrub: 1, end: () => '+=' + (track.scrollWidth - innerWidth), invalidateOnRefresh: true }
});
```
Em mobile, troque por carrossel nativo com `scroll-snap-type: x mandatory` via `gsap.matchMedia()`.

## 5. Parallax

Por scroll: `gsap.to('[data-speed]', { yPercent: (i, el) => -20 * +el.dataset.speed, ease: 'none', scrollTrigger: { scrub: true, trigger: el } })` (itere por elemento).
Por mouse (camadas):
```js
const layers = [...document.querySelectorAll('[data-depth]')].map(el => ({
  x: gsap.quickTo(el, 'x', { duration: 0.8, ease: 'power3' }),
  y: gsap.quickTo(el, 'y', { duration: 0.8, ease: 'power3' }),
  d: +el.dataset.depth
}));
addEventListener('pointermove', e => {
  const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
  layers.forEach(l => { l.x(nx * l.d * 40); l.y(ny * l.d * 40); });
});
```

## 6. Cursor customizado + botão magnético

```js
if (matchMedia('(pointer: fine)').matches) {
  const c = document.querySelector('.cursor');
  const cx = gsap.quickTo(c, 'x', { duration: 0.35, ease: 'power3' });
  const cy = gsap.quickTo(c, 'y', { duration: 0.35, ease: 'power3' });
  addEventListener('pointermove', e => { cx(e.clientX); cy(e.clientY); });
  document.querySelectorAll('[data-magnetic]').forEach(btn => {
    const bx = gsap.quickTo(btn, 'x', { duration: 0.6, ease: 'elastic.out(1,0.4)' });
    const by = gsap.quickTo(btn, 'y', { duration: 0.6, ease: 'elastic.out(1,0.4)' });
    btn.addEventListener('pointermove', e => {
      const r = btn.getBoundingClientRect();
      bx((e.clientX - r.left - r.width / 2) * 0.35);
      by((e.clientY - r.top - r.height / 2) * 0.35);
    });
    btn.addEventListener('pointerleave', () => { bx(0); by(0); });
    btn.addEventListener('pointerenter', () => c.classList.add('is-hover'));
    btn.addEventListener('pointerleave', () => c.classList.remove('is-hover'));
  });
}
```
CSS: `.cursor{position:fixed;left:0;top:0;pointer-events:none;translate:-50% -50%;mix-blend-mode:difference}`. Nunca esconda o cursor nativo em campos de texto.

## 7. Tilt 3D em cards

```js
document.querySelectorAll('[data-tilt]').forEach(card => {
  const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5 });
  const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5 });
  gsap.set(card, { transformPerspective: 900 });
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    ry(((e.clientX - r.left) / r.width - 0.5) * 16);
    rx(-((e.clientY - r.top) / r.height - 0.5) * 16);
    card.style.setProperty('--gx', `${(e.clientX - r.left) / r.width * 100}%`);
    card.style.setProperty('--gy', `${(e.clientY - r.top) / r.height * 100}%`);
  });
  card.addEventListener('pointerleave', () => { rx(0); ry(0); });
});
```
Brilho especular: `background: radial-gradient(circle at var(--gx) var(--gy), rgb(255 255 255 / .18), transparent 40%)`.

## 8. Transições de página

**View Transitions API (multipágina, nativa):** em ambas as páginas, CSS `@view-transition { navigation: auto; }` e nomes compartilhados `view-transition-name: hero-img;`. Suportado em Chromium e Safari 18+; em navegadores sem suporte a navegação simplesmente acontece sem animação (fallback gracioso). Customize: `::view-transition-old(root){animation: fade-out .4s} ::view-transition-new(root){animation: slide-in .6s}`.

**SPA/mesmo documento:** `document.startViewTransition(() => updateDOM())` com checagem `if (!document.startViewTransition) return updateDOM();`.

**Cortina GSAP (qualquer navegador):** intercepte links internos, anime `.curtain` com `scaleY` de 0→1 (origin bottom), navegue em `onComplete`; na nova página anime 1→0 (origin top) no `DOMContentLoaded`.

**Barba.js** (`@barba/core`) quando precisar de transições de site multipágina sem recarregar e com hooks `leave/enter`; reinicialize ScrollTriggers (`ScrollTrigger.getAll().forEach(t => t.kill())`) em cada troca.

**Next.js App Router:** use `template.tsx` com Motion (`motion.div` initial/animate) para entrada; para saída, `AnimatePresence` exige congelar o router context — prefira View Transitions (`next.config` flag `viewTransition` experimental, confira status na versão) ou a biblioteca `next-view-transitions`.

## 9. Preloader honesto
Carregue apenas assets críticos (fonte do hero, imagem/modelo do hero). Use `document.fonts.ready` + `Promise.all` de imagens críticas e um teto (ex.: 2,5 s) para não segurar o usuário. Preloader que demora mais que o LCP piora a experiência.

## 10. React / Next.js
```tsx
'use client';
import { useRef } from 'react';
import gsap from 'gsap'; import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(ScrollTrigger, useGSAP);
export function Hero() {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.from('.title', { yPercent: 100, duration: 1, ease: 'expo.out' });
    });
  }, { scope });
  return <section ref={scope}><h1 className="title">…</h1></section>;
}
```
Lenis em React: `lenis/react` (`<ReactLenis root options={{ autoRaf: false }}>` e alimente pelo `gsap.ticker`).

## 11. Acessibilidade e desempenho
- `prefers-reduced-motion`: sem Lenis, sem scrub/pin, conteúdo visível por padrão (não deixe texto com `opacity:0` se o JS falhar — aplique estados iniciais via JS, não CSS).
- Teclado: foco visível, ordem lógica, sem armadilhas em seções pinadas.
- Pause animações fora da tela (`ScrollTrigger` com `toggleActions: 'play pause resume pause'`, `IntersectionObserver` para canvas).
- `will-change: transform` só durante a animação. Evite `backdrop-filter` grande em elementos animados (custo de GPU alto).
- `ScrollTrigger.refresh()` após carregar imagens/fontes que mudam layout.

## 12. Debug
`markers: true` nos triggers; Chrome DevTools → Performance (procure "Layout" e "Recalculate Style" longos), Rendering → Paint flashing / Layer borders; `ScrollTrigger.getAll()` no console.
