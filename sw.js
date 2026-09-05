// ╔══════════════════════════════════════════════════════╗
// ║   SERVICE WORKER — Mi Tienda Pro                     ║
// ║   Permite que la app cargue aunque no haya internet  ║
// ║   y aunque el empleado presione F5 o cierre Chrome   ║
// ╚══════════════════════════════════════════════════════╝

const CACHE = 'tienda-pro-v1';

// Archivos que se guardan en el dispositivo para funcionar sin internet
const ARCHIVOS = [
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ── INSTALACIÓN: guarda los archivos en el dispositivo ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ARCHIVOS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVACIÓN: limpia cachés viejas ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── INTERCEPCIÓN de peticiones ──
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Firebase y Google APIs → dejar pasar siempre (Firebase maneja su propio offline)
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com/firebasejs') ||
      url.includes('identitytoolkit')) {
    return;
  }

  // Fuentes y librerías CDN → Cache primero, luego red
  if (url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com') ||
      url.includes('cdnjs.cloudflare.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // index.html y archivos locales → Cache primero
  // Si no hay internet y no hay caché → devuelve index.html igual
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
