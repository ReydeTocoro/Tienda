import type Database from 'better-sqlite3'
import { broadcast } from '../broadcast'
import type { Out } from './cash'

/** Runs `fn` in one SQLite transaction and broadcasts what it touched only once it has
 * committed — if `fn` throws, the transaction rolls back and nothing is sent to the clients. */
export function runAndBroadcast<T>(db: Database.Database, fn: (out: Out) => T): T {
  const out: Out = []
  const result = db.transaction(() => fn(out))()
  out.forEach(broadcast)
  return result
}
