import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Customer } from '../../src/types/customer'
import type { Db, Sql } from '../db'
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

async function findByCedula(q: Sql, cedula: string): Promise<Customer | undefined> {
  const [row] = await q.query<{ data: Customer }>(`select data from ${TABLE} where data ->> 'cedula' = $1 limit 1`, [cedula])
  return row?.data
}

/** legacy saveClient()'s cedula-duplicate check (repositories/customers.ts L22-41). */
export function customersRouter(db: Db) {
  const router = Router()

  router.post(
    '/',
    handle(async (req) => {
      const input = req.body as CustomerInput
      const cedula = input.cedula?.trim() || undefined
      return db.tx(async (q) => {
        if (cedula) {
          const dup = await findByCedula(q, cedula)
          if (dup) throw new HttpError(409, 'Esa cédula ya existe: ' + dup.name)
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
        await putRow(q, TABLE, 'id', customer.id, customer)
        return customer
      })
    }, 201),
  )

  router.put(
    '/:id',
    handle(async (req) => {
      const input = req.body as CustomerInput
      return db.tx(async (q) => {
        const existing = await getRow<Customer>(q, TABLE, 'id', req.params.id)
        if (!existing) throw new HttpError(404, 'Cliente no encontrado')
        const cedula = input.cedula?.trim() || undefined
        if (cedula) {
          const dup = await findByCedula(q, cedula)
          if (dup && dup.id !== req.params.id) throw new HttpError(409, 'Esa cédula ya existe: ' + dup.name)
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
        await putRow(q, TABLE, 'id', req.params.id, updated)
        return updated
      })
    }),
  )

  router.delete(
    '/:id',
    handle(async (req) => {
      await db.tx((q) => deleteRow(q, TABLE, 'id', req.params.id))
    }),
  )

  return router
}
