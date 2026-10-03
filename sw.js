// Mantém o app e as leis já consultadas disponíveis sem internet.
// Arquivos do app: rede primeiro (para pegar atualizações), cache se offline.
// Textos das leis: cache primeiro, atualizando em segundo plano.
const CACHE = 'legislacao-v1';
const APP = ['./', 'index.html', 'css/app.css', 'js/app.js', 'leis.json', 'manifest.webmanifest', 'icons/icone.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const ehLei = /\/data\/[^/]+\.json$/.test(url.pathname) && !url.pathname.endsWith('/status.json');

  if (ehLei) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const emCache = await c.match(e.request);
      const daRede = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
      if (emCache) { e.waitUntil(daRede.catch(() => {})); return emCache; }
      return daRede;
    }));
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
