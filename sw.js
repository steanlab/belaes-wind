/*
 * Service worker: делает страницу устанавливаемой и дает ей запуск без сети.
 * Свои файлы берутся из сети, а при отсутствии сети из кэша.
 * Leaflet кэшируется после первой загрузки. Ветер и тайлы карты не кэшируются.
 */
'use strict';

const VERSION = '2.0.0';
const CACHE = `belaes-wind-${VERSION}`;
const SHELL = [
    './',
    'index.html',
    'style.css',
    'script.js',
    'i18n.js',
    'manifest.webmanifest',
    'wind-rose-base.svg',
    'wind-rose-pointer.svg',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png',
    'icons/favicon-32.png'
];
const LEAFLET = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(SHELL);
        // Leaflet с чужого домена: если не вышло, это не мешает установке
        await Promise.allSettled(LEAFLET.map((url) => cache.add(url)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n.startsWith('belaes-wind-') && n !== CACHE).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin === self.location.origin) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE);
            try {
                const res = await fetch(req);
                if (res && res.ok) {
                    // Страница открывается с параметрами (?lang=..), в кэше хранится одна копия index.html
                    const key = req.mode === 'navigate' ? 'index.html' : req;
                    cache.put(key, res.clone());
                }
                return res;
            } catch (error) {
                const cached = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
                if (cached) return cached;
                throw error;
            }
        })());
        return;
    }

    if (LEAFLET.includes(req.url)) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(req);
            if (cached) return cached;
            const res = await fetch(req);
            if (res && res.ok) cache.put(req, res.clone());
            return res;
        })());
    }
    // Остальное (Open-Meteo, тайлы OpenStreetMap) идет напрямую в сеть
});
