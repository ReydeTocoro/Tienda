import type { Customer } from '../../types/customer'
import { apiPost, apiPut } from '../../api/client'

export interface CustomerInput {
  name: string
  cedula?: string
  phone?: string
  email?: string
  notes?: string
  birthday?: string
}

/** legacy saveClient() cedula-duplicate check — now enforced server-side (409). */
export async function addCustomer(input: CustomerInput): Promise<Customer> {
  return apiPost<Customer>('/api/customers', input)
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<void> {
  await apiPut(`/api/customers/${encodeURIComponent(id)}`, input)
}
