import type { CartItem } from './cartItem'

export type PayMethod = 'efectivo' | 'transferencia' | 'fiado'

export interface FiadoPago {
  amount: number
  date: string
  note: string
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
  fiadoPagos?: FiadoPago[]
  corrected?: boolean
  correctedAt?: string
  correctionReason?: string
  /** Set by a Cierre Z once this sale's day is closed. Row is never deleted. */
  closedInCierreId?: number
}
