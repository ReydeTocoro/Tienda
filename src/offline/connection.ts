import { apiUrl } from '../api/base'
import { useConnectionStore } from '../store/useConnectionStore'

/** Knows whether the server can be reached, so the till doesn't have to find out in the middle of a sale.
 *
 * `navigator.onLine` only says a network card is connected — a Wi-Fi with no internet behind it says "online" — so
 * the truth is asked of the server itself: `/api/health` answers `{ ok: true }` when it, and its database, are
 * there. Every call the app makes to the API also reports in (src/api/client.ts), so while people are working the
 * answer is never old; this adds the look-ups for the quiet moments: often while the server is out of reach, to
 * notice it coming back, rarely otherwise. */

const PROBE_TIMEOUT_MS = 6_000
const WHILE_DOWN_MS = 10_000
const WHILE_UP_MS = 60_000
/** Looking again right after something found the server unreachable: most outages are blips of seconds. */
const RECHECK_MS = 3_000

async function ping(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(apiUrl('/api/health'), { cache: 'no-store', signal: controller.signal })
    // The body must be ours: a Wi-Fi login page answers 200 to everything.
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
    return res.ok && body?.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function check(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  if (await ping()) return true
  await new Promise((r) => setTimeout(r, 1_500)) // one more look: a single lost packet isn't an outage
  return ping()
}

let probing: Promise<boolean> | null = null

/** Asks the server if it is there and tells the whole app. One look-up at a time. */
export function probeNow(): Promise<boolean> {
  probing ??= check()
    .then((ok) => {
      useConnectionStore.getState().setReachable(ok)
      return ok
    })
    .finally(() => {
      probing = null
    })
  return probing
}

/** Keeps `useConnectionStore` true to the server's state while the till is open. Returns the function that stops it. */
export function startConnectionMonitor(): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    clearTimeout(timer)
    await probeNow()
    if (stopped) return
    clearTimeout(timer) // a second tick (the network came back) may have armed one meanwhile: keep a single chain
    timer = setTimeout(() => void tick(), useConnectionStore.getState().reachable ? WHILE_UP_MS : WHILE_DOWN_MS)
  }
  const onOnline = () => void tick()
  const onOffline = () => useConnectionStore.getState().setReachable(false)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick()
  }

  // Whatever finds the server unreachable (a call that failed, the `offline` event) — not only this monitor — makes it look
  // again soon: otherwise a blip of a few seconds would keep the till in "no connection" until its next minute-long wait.
  const unsubscribe = useConnectionStore.subscribe((now, before) => {
    if (now.reachable || !before.reachable || stopped) return
    clearTimeout(timer)
    timer = setTimeout(() => void tick(), RECHECK_MS)
  })

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  void tick()
  return () => {
    stopped = true
    unsubscribe()
    clearTimeout(timer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
