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
}

export interface Sale {
  id?: number
  items: CartItem[]
  subtotal: number
  discount: number
  total: number
  ganancia: number
  payMethod: PayMethod
  fiadoName?: string
  customerId?: string
  customerName?: string
  date: string
  /** 'YYYY-MM-DD', indexed — derived from `date` at insert time. */
  dayKey: string
  notes?: string
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
  /** Set by a Cierre Z once this sale's day is closed. Row is never deleted. */
  closedInCierreId?: number
}
