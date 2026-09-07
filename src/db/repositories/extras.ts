import { db } from '../index'
import type { Extra, ExtraType } from '../../types/extra'
import { apiPost } from '../../api/client'

export async function addExtra(desc: string, amount: number, type: ExtraType): Promise<Extra> {
  return apiPost<Extra>('/api/extras', { desc, amount, type })
}

export async function listExtras(): Promise<Extra[]> {
  return db.extras.orderBy('id').reverse().toArray()
}
