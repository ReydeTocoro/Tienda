import { db } from '../index'
import type { Extra, ExtraType } from '../../types/extra'

export async function addExtra(desc: string, amount: number, type: ExtraType): Promise<Extra> {
  const date = new Date().toISOString()
  const dayKey = date.slice(0, 10)
  const extra: Extra = { desc, amount, type, date, dayKey }
  const id = await db.extras.add(extra)
  return { ...extra, id }
}

export async function listExtras(): Promise<Extra[]> {
  return db.extras.orderBy('id').reverse().toArray()
}
