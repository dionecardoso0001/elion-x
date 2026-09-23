/* ═══════════════════════════════════════════════════════════════════════
   ELION-X — SERVICE WORKER

   Existe por UM motivo: sem ele o navegador não oferece "instalar na tela
   inicial". É o que transforma o site em algo com ícone próprio, tela cheia
   e sem barra de endereço.

   ⚠ O QUE ELE DELIBERADAMENTE **NÃO** FAZ: guardar respostas do ELION.
   A tentação óbvia num service worker é cachear tudo para abrir offline.
   Aqui isso seria um defeito grave, não um recurso:

     · as rotas /api/* devolvem e-mail, agenda, WhatsApp, documentos e memória
       do operador. Guardar isso no cache do navegador é espalhar dado pessoal
       por um lugar que ninguém lembra de limpar;
     · uma resposta velha servida como nova faria o ELION mentir com
       convicção — dizer que não há compromisso quando há, que não chegou
       e-mail quando chegou. Informação desatualizada apresentada como atual
       é pior que informação nenhuma.

   Então: só a CASCA entra no cache (HTML, CSS, JS, ícones). Todo pedido que
   traz DADO vai para a rede, sempre, sem exceção — e, se a rede falhar,
   falha à vista do operador em vez de responder com passado.
   ═══════════════════════════════════════════════════════════════════════ */
const VERSAO = 'elion-x-v1';

/* A casca: o que a plataforma precisa para desenhar a si mesma. Nada aqui
   contém dado do operador. */
const CASCA = [
  './',
  './index.html',
  './assets/app.css',
  './assets/elion.png',
  './manifest.webmanifest',
];

self.addEventListener('install', ev => {
  // addAll falha inteiro se UM arquivo faltar; adiciono um a um para a
  // instalação não morrer por causa de um recurso renomeado
  ev.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    await Promise.all(CASCA.map(u => c.add(u).catch(e => console.warn('[sw] pulei', u, e.message))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    // some com as versões antigas: cache velho é como código morto que ainda roda
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== VERSAO).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** Tudo que carrega DADO do operador — nunca pode vir do cache. */
function trazDado(url) {
  return url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/oauth/')
      || url.pathname === '/qr';
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;                    // POST/DELETE nunca passam por cache

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;     // recursos de fora: deixo o navegador cuidar
  if (trazDado(url)) return;                           // dado do operador: SEMPRE da rede

  /* Casca: rede primeiro, cache como rede de segurança. Nesta ordem porque a
     plataforma muda com frequência e servir a versão de ontem esconderia as
     correções de hoje — foi assim que já perdi tempo caçando defeito que eu
     mesmo tinha corrigido. */
  ev.respondWith((async () => {
    try {
      const fresca = await fetch(req);
      if (fresca && fresca.ok) {
        const c = await caches.open(VERSAO);
        c.put(req, fresca.clone()).catch(() => {});
      }
      return fresca;
    } catch (e) {
      const guardada = await caches.match(req);
      if (guardada) return guardada;
      // sem rede e sem cópia: digo o que houve, em vez de uma tela branca
      if (req.mode === 'navigate') {
        return new Response(
          '<meta charset="utf-8"><body style="background:#010710;color:#9bd0ee;font-family:system-ui;' +
          'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px">' +
          '<div><h2 style="letter-spacing:3px">ELION-X FORA DE ALCANCE</h2>' +
          '<p>O computador onde o ELION roda não está respondendo.<br>' +
          'Verifique se ele está ligado e com o servidor no ar.</p></div>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
      }
      throw e;
    }
  })());
});
