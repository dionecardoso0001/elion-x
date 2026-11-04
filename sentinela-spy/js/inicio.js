/* SENTINELA SPY — registro do service worker (arquivo próprio: a CSP não permite script inline). */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('[pwa]', e.message)));
}
