import { onBeforeBooksWrite } from '../api/client'
import { syncNow } from '../sync'
import { useConnectionStore } from '../store/useConnectionStore'
import { startConnectionMonitor } from './connection'
import { flushBeforeBooksWrite, processOutbox } from './outboxSync'

/** How often sales that are still waiting are tried again (a try is skipped while the server is known to be
 * down, or while a recent failure is still being waited out). */
const RETRY_MS = 15_000

/** Everything that lets the till keep selling when the internet goes (src/offline): keeps watch on the
 * connection, and sends the sales kept on this device whenever the server can be reached. Mounted once from
 * AppShell; returns the function that stops it. */
export function startOffline(): () => void {
  // The sales waiting to be sent live in this browser's storage, which a browser may clear when the disk runs
  // short unless it is marked as persistent. Asking is free; the answer (granted or not) changes nothing here.
  void navigator.storage?.persist?.().catch(() => {})
  onBeforeBooksWrite(flushBeforeBooksWrite)
  const stopMonitor = startConnectionMonitor()
  // The server is back: send what was kept right away (the waits after a failure no longer apply), and catch
  // up with what the others did meanwhile.
  const stopListening = useConnectionStore.subscribe((now, before) => {
    if (now.reachable && !before.reachable) {
      void processOutbox({ force: true })
      syncNow()
    }
  })
  void processOutbox() // sales left from the last time the app was open
  const retry = setInterval(() => void processOutbox(), RETRY_MS)
  return () => {
    stopMonitor()
    stopListening()
    clearInterval(retry)
  }
}
