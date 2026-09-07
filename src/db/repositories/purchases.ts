import { db } from '../index'
import type { Purchase } from '../../types/purchase'
import { apiPost } from '../../api/client'

export interface SavePurchaseInput {
  desc: string
  total: number
  provider?: string
}

export async function savePurchase(input: SavePurchaseInput): Promise<Purchase> {
  return apiPost<Purchase>('/api/purchases', input)
}

export async function listPurchases(): Promise<Purchase[]> {
  return db.purchases.orderBy('id').reverse().toArray()
}
