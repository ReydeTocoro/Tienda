import { db } from '../index'
import type { Purchase } from '../../types/purchase'

export interface SavePurchaseInput {
  desc: string
  total: number
  provider?: string
}

export async function savePurchase(input: SavePurchaseInput): Promise<Purchase> {
  const date = new Date().toISOString()
  const dayKey = date.slice(0, 10)
  const purchase: Purchase = {
    items: [{ name: input.desc, qty: 1, price: input.total }],
    desc: input.provider ? `${input.provider}: ${input.desc}` : input.desc,
    total: input.total,
    date,
    dayKey,
  }
  const id = await db.purchases.add(purchase)
  return { ...purchase, id }
}

export async function listPurchases(): Promise<Purchase[]> {
  return db.purchases.orderBy('id').reverse().toArray()
}
