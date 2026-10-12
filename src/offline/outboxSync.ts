import { ApiError, apiPost } from '../api/client'
import { db } from '../db/index'
import { syncNow } from '../sync'
import { useConnectionStore } from '../store/useConnectionStore'
import { toast } from '../store/useToastStore'
import type { Sale } from '../types/sale'
import { noteAttempt, outboxCounts, rejectSale, settleSale, type SentSale } from './outbox'

/** Sends the sales kept on this device (./outbox) to the server, oldest first, one at a time.
 *
 * Sending is safe to repeat: every sale carries its `clientId`, and the server saves a code once whatever number
 * of times it arrives, answering the repeats with the sale it already has. So a lost answer, a request that was
 * cut off halfway or two tabs sending the same queue can never save a sale twice. What happens to each one:
 *  - saved (or already there): it leaves the outbox and the real sale takes its place;
 *  - the server could not be reached, or is failing for everybody (no internet, 502/503/504, 429): the run stops
 *    and the sales stay for the next one, later, with growing waits;
 *  - the session is not valid (401/403): the run stops until somebody signs in — nothing is lost;
 *  - a failure of that sale alone (500): it is skipped for now, the rest go on;
 *  - the server refuses the sale itself (4xx): it is set aside as "rechazada" for a person to decide. */

/** A sale is one small request; a Function waking up takes seconds, not half a minute. */
const SEND_TIMEOUT_MS = 30_000
/** Wait before the next automatic try after a run that failed, growing with each failure in a row. */
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000, 60_000]

type Answer = SentSale & { sale: Sale; duplicate: boolean }

export interface SendReport {
  /** Sales the server saved in this run. */
  sent: number
  /** Sales still waiting to be sent after it. */
  left: number
  /** Why it stopped early: 'offline' (the server can't be reached), 'login' (the session isn't valid), 'busy' (another tab is sending). */
  stoppedBy?: 'offline' | 'login' | 'busy'
}

let failures = 0
let notBefore = 0
let running: Promise<SendReport> | null = null

type Verdict = 'offline' | 'login' | 'skip' | 'reject'

function judge(err: unknown): Verdict {
  if (!(err instanceof ApiError)) return 'offline' // no answer, or one that isn't ours (a Wi-Fi login page)
  if (err.status === 401 || err.status === 403) return 'login'
  // 404: this route is new — an older server that doesn't have it yet (the screens were updated before the API) is just
  // "not ready": the sales wait. The route itself never answers 404 for a reason of its own.
  if (err.status === 404 || err.status === 408 || err.status === 429 || (err.status >= 502 && err.status <= 504)) return 'offline'
  return err.status >= 500 ? 'skip' : 'reject'
}

async function run(): Promise<SendReport> {
  let sent = 0
  let stoppedBy: SendReport['stoppedBy']
  const skipped = new Set<string>()
  for (;;) {
    const next = (await db.outbox.orderBy('seq').toArray()).find((e) => e.status === 'pending' && !skipped.has(e.clientId))
    if (!next) break
    try {
      const answer = await apiPost<Answer>('/api/sales/offline', next.payload, { timeoutMs: SEND_TIMEOUT_MS })
      await settleSale(next.clientId, answer)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const verdict = judge(err)
      if (verdict === 'reject') {
        await rejectSale(next.clientId, message)
        continue
      }
      await noteAttempt(next.clientId, message)
      if (verdict === 'skip') {
        skipped.add(next.clientId)
        continue
      }
      stoppedBy = verdict
      break
    }
  }
  if (sent) {
    toast(sent === 1 ? 'Se envió 1 venta guardada sin internet' : `Se enviaron ${sent} ventas guardadas sin internet`, 'green')
    failures = 0
    notBefore = 0
    syncNow() // belt and braces: whatever the answers said, the sync puts the server's own figures back
  }
  if (stoppedBy || skipped.size) {
    failures++
    notBefore = Date.now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]
  }
  return { sent, left: (await outboxCounts()).pending, stoppedBy }
}

/** Runs `fn` while holding the device-wide lock: another tab or window of the same browser profile that
 * sends the queue at the same moment waits (`wait`) or gives up (`busy`). Without Web Locks only this tab's
 * own guard applies — the server's dedupe covers the rest. */
async function exclusive(wait: boolean): Promise<SendReport> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return run()
  const report = await locks.request('tienda-outbox', wait ? {} : { ifAvailable: true }, (lock) => (lock ? run() : null))
  return report ?? { sent: 0, left: (await outboxCounts()).pending, stoppedBy: 'busy' }
}

/** Sends what is waiting. The automatic tries (`force` off) keep quiet while the server is known to be
 * unreachable and while a recent failure is still being waited out; `force` (a person pressed "Enviar ahora",
 * or something is about to need the server up to date) goes anyway. `wait`: queue behind another tab that is
 * already sending, instead of leaving it to it. */
export function processOutbox(opts: { force?: boolean; wait?: boolean } = {}): Promise<SendReport> {
  if (!opts.force && (!useConnectionStore.getState().reachable || Date.now() < notBefore)) {
    return outboxCounts().then((c) => ({ sent: 0, left: c.pending }))
  }
  running ??= exclusive(!!opts.wait)
    .catch(async (err): Promise<SendReport> => {
      // Not the server's doing (the device's own storage failed, say): the sales stay where they are, nothing is lost.
      console.error('Ventas sin internet: falló el envío', err)
      return { sent: 0, left: (await outboxCounts()).pending, stoppedBy: 'offline' }
    })
    .finally(() => {
      running = null
    })
  return running
}

/** Before something that adds up what the sales did to the stock or the caja (a count, an entry of goods, a
 * cierre…), the sales waiting here go first: otherwise that work and those sales would count the same goods
 * twice or leave them out. Silent when nothing waits or the server can't be reached (the work then fails by
 * itself, with its own message). */
export async function flushBeforeBooksWrite(): Promise<void> {
  if (!(await outboxCounts()).pending || !useConnectionStore.getState().reachable) return
  const { left } = await processOutbox({ force: true, wait: true })
  if (left > 0) {
    throw new Error('Hay ventas hechas sin internet que todavía no se han enviado al servidor. Espera a que se envíen (se ve arriba) e inténtalo de nuevo')
  }
}
