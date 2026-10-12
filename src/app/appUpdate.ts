import { useBusyStore } from '../store/useBusyStore'
import { useCartStore } from '../store/useCartStore'
import { toast } from '../store/useToastStore'

/** How often an open app asks whether there is a newer version (and also whenever it comes back to the front or the
 * internet returns). The service worker does the downloading; this decides WHEN the page restarts to use it. */
const LOOK_EVERY_MS = 5 * 60_000
/** While a sale is half done the restart waits, looking again this often. */
const RETRY_MS = 10_000

/** Restarting the page loses nothing only when: no cart holds products (carts live in memory), no sheet is open (a half
 * filled form) and no save is in flight. The sales waiting for the internet are kept on the device and survive it. */
export function safeToReload(): boolean {
  return useCartStore.getState().carts.every((c) => c.items.length === 0) && !document.querySelector('dialog[open]') && useBusyStore.getState().pending === 0
}

let waiting = false

/** A newer version took over: restart the page as soon as nobody is in the middle of something. */
function reloadWhenSafe(): void {
  if (waiting) return
  waiting = true
  let told = false
  const tryNow = () => {
    if (safeToReload()) {
      window.location.reload()
      return
    }
    if (!told) {
      told = true
      toast('Hay una versión nueva: se instala sola al terminar esta venta', 'blue')
    }
    setTimeout(tryNow, RETRY_MS)
  }
  tryNow()
}

/** Keeps the installed web app on the latest published version without anyone doing anything: registers the service
 * worker, asks for a newer one every few minutes, and when one takes over restarts the page — right away if the till is
 * idle, after the sale if not. (The new worker takes control by itself — `skipWaiting` + `clientsClaim`, see
 * vite.config.ts — so an app still running an older build also gets here.) Not in the installed .exe/.apk (their files
 * are already on the device) nor in development. */
export function startAppUpdate(): void {
  if (import.meta.env.DEV || import.meta.env.VITE_PACKAGED === '1' || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  // A first installation also "takes control" of the page, which is not an update.
  let hadController = !!sw.controller
  sw.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    reloadWhenSafe()
  })
  // A chunk of the app that the new version no longer has (a page left open on the old one): restart too.
  window.addEventListener('vite:preloadError', () => reloadWhenSafe())

  const register = () =>
    void sw
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        const look = () => void registration.update().catch(() => undefined) // no internet: nothing to look for
        setInterval(look, LOOK_EVERY_MS)
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && look())
        window.addEventListener('online', look)
      })
      .catch(() => undefined)
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)
}
