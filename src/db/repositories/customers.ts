import { db } from '../index'
import type { Customer } from '../../types/customer'
import { apiPost, apiPut, apiDelete } from '../../api/client'

export interface CustomerInput {
  name: string
  cedula?: string
  phone?: string
  email?: string
  notes?: string
  birthday?: string
}

export async function listCustomers(): Promise<Customer[]> {
  return db.customers.toArray()
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  return db.customers.get(id)
}

/** legacy saveClient() cedula-duplicate check — now enforced server-side (409). */
export async function addCustomer(input: CustomerInput): Promise<Customer> {
  return apiPost<Customer>('/api/customers', input)
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<void> {
  await apiPut(`/api/customers/${encodeURIComponent(id)}`, input)
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiDelete(`/api/customers/${encodeURIComponent(id)}`)
}
