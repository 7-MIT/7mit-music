// Service worker: caches the app shell for offline start-up and covers as they are seen. Audio is never cached here.
const V = 'auralys-shell-v1';
const SHELL = ['/', '/css/app.css', '/js/main.js', '/js/theme-init.js', '/manifest.webmanifest', '/assets/UC.png', '/assets/icon-192.png', '/media/covers/default.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.includes('/stream') || u.pathname === '/ws') return;
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).catch(() => caches.match('/'))); return; }
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});
