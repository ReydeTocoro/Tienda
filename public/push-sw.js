/* The Administrador's phone notifications ("Pendientes de hoy" at fixed hours), added to the app's service worker by
 * vite.config.ts (workbox `importScripts`). The Function sends them through Firebase Cloud Messaging as data
 * (functions/index.js); this shows them, and opens the app on the notices when one is tapped. */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // Not JSON: a notification with the defaults below.
  }
  const d = { ...(payload.notification || {}), ...(payload.data || {}) }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Pendientes de hoy', {
      body: d.body || '',
      icon: '/icons/logo-192.png',
      badge: '/icons/favicon-32.png',
      // A newer reminder replaces the one still on screen, and still rings.
      tag: 'pendientes',
      renotify: true,
      data: { link: d.link || '/?avisos=1' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/?avisos=1'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      // An app already open is not reloaded (a sale may be half done): it is told to show the notices.
      if (open) {
        open.postMessage({ type: 'avisos' })
        return open.focus()
      }
      return self.clients.openWindow(link)
    }),
  )
})
