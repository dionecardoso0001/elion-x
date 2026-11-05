/* ═══════════════════════════════════════════════════════════════════════
   SENTINELA SPY — service worker (aplicativo instalável e funcionando sem rede)

   · Casca (HTML/CSS/JS): REDE PRIMEIRO, cache como rede de segurança —
     a versão nova sempre vence quando há rede.
   · Runtime (vendor/), fontes e ícones: CACHE PRIMEIRO — o caminho do
     runtime carrega a versão exata, então nunca fica velho.
   · Modelos: não passam por aqui — o próprio app guarda em cache com
     SHA-256 conferido a cada carga (spy-modelos-*), e este SW não apaga.
   · API do agente e qualquer origem de fora: SEMPRE rede, nunca cache.
   ═══════════════════════════════════════════════════════════════════════ */
const VERSAO = 'spy-casca-v3';
const CASCA = [
  './', 'index.html', 'manifest.webmanifest', 'css/spy.css',
  'js/inicio.js', 'js/nucleo.js', 'js/config.js', 'js/geometria.js', 'js/rastreador.js', 'js/motorista.js',
  'js/transito.js', 'js/vigilancia.js', 'js/anomalia.js', 'js/alertas.js', 'js/sirene.js', 'js/hud.js',
  'js/gravador.js', 'js/avaliacao.js', 'js/percepcao.js', 'js/agente.js',
  'js/cameras.js', 'js/escuro.js', 'js/fauna.js', 'js/saude.js', 'js/escuta.js', 'js/spy/alerta.js', 'js/laboratorio.js', 'js/spy/labdb.js',
  'js/spy/cerebro.js', 'js/spy/cliente.js', 'js/spy/incidentes.js',
  'icones/icone.svg', 'icones/icone-192.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    // um arquivo que falte não pode impedir a instalação do resto
    await Promise.allSettled(CASCA.map(u => c.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n.startsWith('spy-casca-') && n !== VERSAO).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;            // API da Anthropic, CDN: o navegador cuida
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (rel.startsWith('api/') || rel.startsWith('modelos/')) return;

  const imutavel = rel.startsWith('vendor/') || rel.startsWith('fontes/') || rel.startsWith('icones/');
  ev.respondWith((async () => {
    const c = await caches.open(VERSAO);
    if (imutavel) {
      const guardada = await c.match(req);
      if (guardada) return guardada;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone()).catch(() => {});
      return r;
    }
    try {
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone()).catch(() => {});
      return r;
    } catch (e) {
      const guardada = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
      if (guardada) return guardada;
      throw e;
    }
  })());
});
