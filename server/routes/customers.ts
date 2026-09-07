import { Router } from 'express'
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Customer } from '../../src/types/customer'
import { listAll, getRow, putRow, deleteRow } from './generic'
import { broadcast } from '../broadcast'

const TABLE = 'customers'

interface CustomerInput {
  name: string
  cedula?: string
  phone?: string
  email?: string
  notes?: string
  birthday?: string
}

function findByCedula(db: Database.Database, cedula: string): Customer | undefined {
  const row = db.prepare(`SELECT json FROM ${TABLE} WHERE cedula = ?`).get(cedula) as { json: string } | undefined
  return row ? (JSON.parse(row.json) as Customer) : undefined
}

/** legacy saveClient()'s cedula-duplicate check (repositories/customers.ts L22-41). */
export function customersRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Customer>(db, TABLE))
  })

  router.post('/', (req, res) => {
    const input = req.body as CustomerInput
    const cedula = input.cedula?.trim() || undefined
    if (cedula) {
      const dup = findByCedula(db, cedula)
      if (dup) return res.status(409).json({ error: 'Esa cédula ya existe: ' + dup.name })
    }
    const customer: Customer = {
      id: randomUUID(),
      name: input.name.trim(),
      cedula,
      phone: input.phone?.trim(),
      email: input.email?.trim(),
      notes: input.notes?.trim(),
      birthday: input.birthday,
      createdAt: new Date().toISOString(),
    }
    putRow(db, TABLE, 'id', customer.id, { cedula: cedula ?? null }, customer)
    broadcast({ table: TABLE, op: 'put', data: customer })
    res.status(201).json(customer)
  })

  router.put('/:id', (req, res) => {
    const input = req.body as CustomerInput
    const existing = getRow<Customer>(db, TABLE, 'id', req.params.id)
    if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' })
    const cedula = input.cedula?.trim() || undefined
    if (cedula) {
      const dup = findByCedula(db, cedula)
      if (dup && dup.id !== req.params.id) return res.status(409).json({ error: 'Esa cédula ya existe: ' + dup.name })
    }
    const updated: Customer = {
      ...existing,
      name: input.name.trim(),
      cedula,
      phone: input.phone?.trim(),
      email: input.email?.trim(),
      notes: input.notes?.trim(),
      birthday: input.birthday,
    }
    putRow(db, TABLE, 'id', req.params.id, { cedula: cedula ?? null }, updated)
    broadcast({ table: TABLE, op: 'put', data: updated })
    res.json(updated)
  })

  router.delete('/:id', (req, res) => {
    deleteRow(db, TABLE, 'id', req.params.id)
    broadcast({ table: TABLE, op: 'delete', data: req.params.id })
    res.status(204).end()
  })

  return router
}
