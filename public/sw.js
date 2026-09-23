// Service Worker — ETK Comissoes PWA
// VERSAO: altere a cada deploy com mudança de frontend. O navegador só detecta nova versão
// quando o conteúdo deste arquivo muda — aí o SW novo instala, fica em espera e a tela mostra
// "Nova atualização disponível" / "ATUALIZAR AGORA" (ver index.html).
const VERSAO = '2026-09-23.1';
const CACHE_NAME = `etk-comissoes-${VERSAO}`;
const ASSETS_TO_CACHE = [
  '/index.html',
  '/estilo.css',
  '/app.js',
  '/auth.js',
  '/formatacao.js',
  '/fretes.js',
  '/precificacao.js',
  '/relatorios.js',
  '/usuarios.js',
  '/favicon.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/logos/logos-etk-lado-a-lado.png',
  '/manifest.json'
];

// Install: cache static assets (sempre da rede, nunca do cache HTTP, para pegar os arquivos
// novos). Sem skipWaiting aqui: a nova versão espera o clique em "ATUALIZAR AGORA", para
// nunca trocar os arquivos no meio de uma operação.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS_TO_CACHE.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
});

// "ATUALIZAR AGORA": ativa a versão em espera (a página recarrega no controllerchange).
self.addEventListener('message', (event) => {
  if (event.data && event.data.tipo === 'ATIVAR_NOVA_VERSAO') self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls and auth: always go to network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
