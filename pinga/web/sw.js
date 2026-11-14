// Keeps the app's own files on the phone so Pinga opens with no signal.
// VERSION and FILES are written by `npm run stamp`; a new version replaces the old one in full.
const VERSION = '502c7a2a6ad2';
const FILES = ["css/app.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","index.html","js/admin.js","js/api.js","js/billing.js","js/camera.js","js/config.js","js/export.js","js/field.js","js/gps.js","js/main.js","js/outbox.js","js/overview.js","js/phone.js","js/queue.js","js/report.js","js/staff.js","js/sync.js","js/today.js","js/ui.js","js/xlsx.js","manifest.webmanifest"];

const CACHE = 'pinga-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...FILES])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pinga-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./', { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
