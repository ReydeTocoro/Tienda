import type { PaymentTerms, Supplier } from '../../types/supplier'
import { apiDelete, apiPost, apiPut } from '../../api/client'

export interface SupplierInput {
  name: string
  nit?: string
  contact?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  paymentTerms: PaymentTerms
  active?: boolean
}

export const createSupplier = (input: SupplierInput): Promise<Supplier> => apiPost<Supplier>('/api/suppliers', input)
export const updateSupplier = (id: string, input: SupplierInput): Promise<Supplier> => apiPut<Supplier>(`/api/suppliers/${encodeURIComponent(id)}`, input)
export const deleteSupplier = (id: string): Promise<void> => apiDelete(`/api/suppliers/${encodeURIComponent(id)}`)
