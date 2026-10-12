import type { CartItem } from './cartItem'
import type { TransferAccount } from '../shared/lib/transferAccounts'
import type { PayMethod } from './sale'

/** What a device sends for a sale it made without internet: server/domain/offlineSales.ts reads exactly these
 * fields (and works out the rest — profit, totals, who made it — itself). */
export interface OfflineSalePayload {
  /** The code that makes sending this sale twice harmless. */
  clientId: string
  /** When the sale was made, by this device's clock. */
  soldAt: string
  /** Who was working (the server looks the person up; it never trusts the name). */
  seller?: { id: string; name: string }
  /** The provisional number printed on the receipt: "PEND-0003". */
  localRef: string
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  roundingAdjustment?: number
  payMethod: PayMethod
  transferAccount?: TransferAccount
  customerId?: string | null
  customerName?: string | null
  fiadoName?: string | null
  notes?: string
  amountReceived?: number
  changeGiven?: number
}

/** A sale kept on this device until the server has it (IndexedDB, so it survives closing the app). The sale
 * shown in the lists meanwhile is a row of `sales` with the id `-seq`. */
export interface OutboxSale {
  /** Auto-increment key — also what the provisional sale's number is made of. */
  seq?: number
  clientId: string
  createdAt: string
  /** 'pending': waiting to be sent (or being sent). 'rejected': the server refused it, a person decides. */
  status: 'pending' | 'rejected'
  attempts: number
  lastError?: string
  lastTriedAt?: string
  payload: OfflineSalePayload
}
