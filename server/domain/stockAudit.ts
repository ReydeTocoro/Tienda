import { STOCK_AUDIT_DAYS, STOCK_AUDIT_TYPES, type StockAuditEntry } from '../../src/types/auditLog'
import { addDaysToKey } from '../../src/shared/lib/cash'
import { todayKey } from '../../src/shared/lib/currency'
import type { Sql } from '../db'
import { roundQty } from '../routes/generic'

export type StockEntry = Omit<StockAuditEntry, 'id'>

/** One line of the stock audit trail (the "Auditoría" of Stock): which product, from what to what, why, and who.
 * Without a `type`, the direction says it: up is an "ajuste", down a "merma". */
export function stockEntry(p: { code: string; name: string }, before: number, after: number, reason: string, user: string, type?: StockAuditEntry['type'], date = new Date().toISOString()): StockEntry {
  const diff = roundQty(after - before)
  return { type: type ?? (diff < 0 ? 'merma' : 'ajuste'), date, code: p.code, name: p.name, before, after, diff, reason, user }
}

/** Writes the lines in the caller's transaction — the same as the stock they describe — and, in that one statement,
 * deletes the stock movements older than `STOCK_AUDIT_DAYS` store days (the deletion reaches every device like any
 * other). Nothing to write, nothing done: a quiet day keeps the old lines until the next movement, and the screen
 * only shows the last days anyway. */
export async function logStock(q: Sql, entries: StockEntry[]): Promise<void> {
  if (!entries.length) return
  // The start of the oldest day kept, in Bogotá (Colombia keeps UTC-5 all year).
  const keepFrom = new Date(`${addDaysToKey(todayKey(), 1 - STOCK_AUDIT_DAYS)}T00:00:00-05:00`).toISOString()
  await q.query(
    `with old as (delete from public."auditLog" where data ->> 'type' = any($2::text[]) and (data ->> 'date')::timestamptz < $3::timestamptz)
     insert into public."auditLog" (data) select e.value from jsonb_array_elements($1::jsonb) with ordinality as e(value, n) order by e.n`,
    [JSON.stringify(entries), [...STOCK_AUDIT_TYPES], keepFrom],
  )
}
