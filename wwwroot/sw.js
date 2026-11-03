// EstimationStation Service Worker
const CACHE_NAME = 'estimation-station-v8';
const STATIC_ASSETS = [
    '/css/site.css',
    '/js/site.js',
    '/js/wordle.js',
    '/js/crossword.js',
    '/lib/bootstrap/dist/css/bootstrap.min.css',
    '/lib/bootstrap/dist/js/bootstrap.bundle.min.js',
    '/lib/jquery/dist/jquery.min.js',
    '/manifest.json',
    '/favicon.ico',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(err => console.warn('[SW] Cache install failed:', err))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Only cache GET requests for static assets; skip SignalR/API
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/pokerhub')) return;
    // Never cache the admin usage report or the stats beacon.
    if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/_stats/')) return;

    // Navigation requests should prefer fresh HTML so updates appear without hard refresh.
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request).then(cached => cached || caches.match('/')))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
