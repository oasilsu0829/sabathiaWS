// 오프라인 우선 서비스 워커. 앱 셸을 캐시하고, 새 버전은 백그라운드에서 갱신한다.
const VERSION = 'sabathia-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/app.css',
  './src/app.js',
  './src/store.js',
  './src/sample.js',
  './src/engine/time.js',
  './src/engine/config.js',
  './src/engine/planner.js',
  './src/engine/capacity.js',
  './src/engine/simulate.js',
  './src/engine/decide.js',
  './src/ui/dom.js',
  './src/ui/sheets.js',
  './src/ui/home.js',
  './src/ui/planner.js',
  './src/ui/schedule.js',
  './src/ui/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// stale-while-revalidate: 캐시를 바로 보여주고 네트워크로 갱신
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
