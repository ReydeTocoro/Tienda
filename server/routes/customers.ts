import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Customer } from '../../src/types/customer'
import type { Db, Sql } from '../db'
import { authOf } from '../auth'
import { actorOf, requireNeed } from '../domain/counter'
import { getRow, putRow, deleteRow } from './generic'
import { HttpError, handle } from './http'

const TABLE = 'customers'

interface CustomerInput {
  name: string
  cedula?: string
  phone?: string
  email?: string
  notes?: string
  birthday?: string
}

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

function clean(input: CustomerInput) {
  const name = text(input?.name, 80)
  if (!name) throw new HttpError(400, 'Escribe el nombre del cliente')
  const birthday = typeof input.birthday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.birthday) ? input.birthday : undefined
  return { name, cedula: text(input.cedula, 30), phone: text(input.phone, 30), email: text(input.email, 80), notes: text(input.notes, 300), birthday }
}

async function findByCedula(q: Sql, cedula: string): Promise<Customer | undefined> {
  const [row] = await q.query<{ data: Customer }>(`select data from ${TABLE} where data ->> 'cedula' = $1 limit 1`, [cedula])
  return row?.data
}

/** Customers, mounted at /api/customers — writing needs `clientes.editar`. A cédula belongs to one
 * customer only. */
export function customersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => {
      const input = clean(req.body as CustomerInput)
      return db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'clientes.editar')
        if (input.cedula) {
          const dup = await findByCedula(q, input.cedula)
          if (dup) throw new HttpError(409, 'Esa cédula ya existe: ' + dup.name)
        }
        const customer: Customer = { id: randomUUID(), ...input, createdAt: new Date().toISOString() }
        await putRow(q, TABLE, 'id', customer.id, customer)
        return customer
      })
    }, 201),
  )

  router.put(
    '/:id',
    handle(async (req) => {
      const input = clean(req.body as CustomerInput)
      return db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'clientes.editar')
        const existing = await getRow<Customer>(q, TABLE, 'id', req.params.id)
        if (!existing) throw new HttpError(404, 'Cliente no encontrado')
        if (input.cedula) {
          const dup = await findByCedula(q, input.cedula)
          if (dup && dup.id !== req.params.id) throw new HttpError(409, 'Esa cédula ya existe: ' + dup.name)
        }
        const updated: Customer = { ...existing, ...input }
        await putRow(q, TABLE, 'id', req.params.id, updated)
        return updated
      })
    }),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx(async (q) => {
        await requireNeed(q, await actorOf(q, authOf(req)), 'clientes.editar')
        await deleteRow(q, TABLE, 'id', req.params.id)
      })
    }),
  )

  return router
}
