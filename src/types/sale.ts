import type { TransferAccount } from '../shared/lib/transferAccounts'
import type { CartItem } from './cartItem'

export type PayMethod = 'efectivo' | 'transferencia' | 'fiado'

export interface FiadoPago {
  amount: number
  date: string
  note: string
  /** The debt was forgiven, not collected: closes it without any money entering a caja. */
  condonado?: boolean
  /** How the payment was collected (absent on older rows = efectivo). */
  method?: 'efectivo' | 'transferencia'
  /** The account a transfer came into (absent on older payments and on cash). */
  account?: TransferAccount
}

export interface Sale {
  id?: number
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  /** Profit, computed by the server. Never in the synced row — the database files it in "profits"
   * (`ganancias.ver`); the app merges it in where it may show it. */
  ganancia?: number
  payMethod: PayMethod
  /** For a sale paid by transfer: the account it came into. Absent on older sales and on one made from a screen that
   * doesn't ask (the day's close lists those as "sin cuenta indicada"). */
  transferAccount?: TransferAccount
  fiadoName?: string
  customerId?: string
  customerName?: string
  date: string
  /** 'YYYY-MM-DD', indexed — derived from `date` at insert time. */
  dayKey: string
  notes?: string
  /** Who was signed in when the sale was made (absent when the open counter sold with nobody signed in). */
  sellerId?: string
  sellerName?: string
  /** Cash-register tender info (cash sales only). `roundingAdjustment` is the signed difference
   * between what was actually charged (`total`) and the raw subtotal-minus-discount — common in
   * cash-only stores that round to the nearest bill/coin. Kept explicit so books stay honest
   * instead of `total` silently drifting from `subtotal - discount`. */
  roundingAdjustment?: number
  amountReceived?: number
  changeGiven?: number
  fiadoPagos?: FiadoPago[]
  corrected?: boolean
  correctedAt?: string
  correctionReason?: string
  /** The invoice was annulled: the goods went back to the inventory and the money back out of the caja, but the row
   * stays as history. Every total, report, fiado and customer figure leaves it out. */
  voided?: boolean
  voidedAt?: string
  voidedBy?: string
  voidReason?: string
  /** Set by a Cierre Z once this sale's day is closed. Row is never deleted. */
  closedInCierreId?: number

  // ── Sales that cross a bad connection ──────────────────────────────────────────────────────────
  /** The code the device gave this sale when it was made (a UUID). Sending a sale twice — a reply that
   * got lost, a retry after the internet came back — can't save it twice: the server knows the code. */
  clientId?: string
  /** Made on a device without internet and sent later (server/domain/offlineSales.ts). */
  offline?: boolean
  /** When the server received it (an offline sale's `date` is when it was made). */
  syncedAt?: string
  /** Who sent it, when that isn't who made it (another cashier signed in before it was sent). */
  syncedBy?: string
  /** The provisional number printed on the receipt while it had none ("PEND-0003"). */
  refLocal?: string
  /** What did not add up when the server received an offline sale — stock that wasn't there, a price that
   * changed, a discount nobody authorized… The sale is kept anyway (the goods already left); the owner
   * reads these and marks the sale as reviewed. */
  reviewNotes?: string[]
  reviewedAt?: string
  reviewedBy?: string
  /** LOCAL ONLY — never stored on the server: a sale saved on this device that hasn't reached the server
   * yet (its `id` is negative until it does). */
  pendingSync?: boolean
}
