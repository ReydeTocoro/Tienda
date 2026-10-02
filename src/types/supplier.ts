export type PaymentTerms = { kind: 'contado' } | { kind: 'credito'; days: number }

export interface Supplier {
  id: string
  name: string
  nit?: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  paymentTerms: PaymentTerms
  /** Inactive suppliers stay in old orders but can't receive new ones. */
  active: boolean
  createdAt: string
}
