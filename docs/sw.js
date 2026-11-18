// Service worker — PWA Techniciens
// Met en cache UNIQUEMENT les fichiers de l'interface (même origine).
// Les appels au relais Cloudflare ne sont JAMAIS interceptés ni mis en cache.
const VERSION = 'techniciens-v12';
const FICHIERS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Ouverture instantanée : on sert le cache tout de suite, et on met à jour en arrière-plan.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!req.url.startsWith(self.registration.scope)) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const enCache = (await cache.match(req, { ignoreSearch: true })) ||
                    (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    const reseau = fetch(req).then((rep) => {
      if (rep && rep.ok) cache.put(req, rep.clone()).catch(() => {});
      return rep;
    }).catch(() => enCache);
    return enCache || reseau;
  })());
});
