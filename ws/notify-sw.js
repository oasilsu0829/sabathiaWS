// WS 서비스 워커: 설치 및 오프라인 캐시.
// 네트워크 먼저(새 버전이 바로 보이게), 오프라인일 때만 캐시. 다른 주소(일정 API·Firestore·글꼴)는 건드리지 않는다.
const CACHE = 'sabathia-ws-1';
const SHELL = ['./', './manifest.webmanifest', './boot.js', './boot.mp3', './bg.webp'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sabathia-ws-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  e.respondWith(
    caches.open(CACHE).then((c) =>
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok && !res.redirected) c.put(nav ? './' : req, res.clone());
          return res;
        })
        .catch(async () => (await c.match(nav ? './' : req, { ignoreSearch: nav })) ?? Response.error()),
    ),
  );
});
