import { Router } from 'express'
import type Database from 'better-sqlite3'
import { errorMessage, listAll } from './generic'
import { runAndBroadcast } from '../domain/tx'
import { createSupplier, deleteSupplier, updateSupplier, type SupplierInput } from '../domain/purchasing'
import type { Supplier } from '../../src/types/supplier'

export function suppliersRouter(db: Database.Database) {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(listAll<Supplier>(db, 'suppliers'))
  })

  router.post('/', (req, res) => {
    try {
      res.status(201).json(runAndBroadcast(db, (out) => createSupplier(db, out, req.body as SupplierInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.put('/:id', (req, res) => {
    try {
      res.json(runAndBroadcast(db, (out) => updateSupplier(db, out, req.params.id, req.body as SupplierInput)))
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  router.delete('/:id', (req, res) => {
    try {
      runAndBroadcast(db, (out) => deleteSupplier(db, out, req.params.id))
      res.status(204).end()
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) })
    }
  })

  return router
}
