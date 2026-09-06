import { db } from '../index'
import type { Customer } from '../../types/customer'
import { generateId } from '../../shared/lib/id'

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

/** legacy `saveClient()` cedula-duplicate check (index.html L4410-4419). */
export async function addCustomer(input: CustomerInput): Promise<Customer> {
  const cedula = input.cedula?.trim()
  if (cedula) {
    const dup = await db.customers.where('cedula').equals(cedula).first()
    if (dup) throw new Error('Esa cédula ya existe: ' + dup.name)
  }
  const customer: Customer = {
    id: generateId(),
    name: input.name.trim(),
    cedula,
    phone: input.phone?.trim(),
    email: input.email?.trim(),
    notes: input.notes?.trim(),
    birthday: input.birthday,
    createdAt: new Date().toISOString(),
  }
  await db.customers.add(customer)
  return customer
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<void> {
  const cedula = input.cedula?.trim()
  if (cedula) {
    const dup = await db.customers.where('cedula').equals(cedula).first()
    if (dup && dup.id !== id) throw new Error('Esa cédula ya existe: ' + dup.name)
  }
  await db.customers.update(id, {
    name: input.name.trim(),
    cedula,
    phone: input.phone?.trim(),
    email: input.email?.trim(),
    notes: input.notes?.trim(),
    birthday: input.birthday,
  })
}

export async function deleteCustomer(id: string): Promise<void> {
  await db.customers.delete(id)
}
