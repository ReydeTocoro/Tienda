import Dexie, { type EntityTable } from 'dexie'
import type { Product } from '../types/product'
import type { Sale } from '../types/sale'
import type { Purchase } from '../types/purchase'
import type { Customer } from '../types/customer'
import type { Extra } from '../types/extra'
import type { Cierre } from '../types/cierre'
import type { AuditLogEntry } from '../types/auditLog'
import type { EntradaRecord } from '../types/entrada'
import type { Settings } from '../types/settings'
import type { Usuario } from '../types/usuario'

export class TiendaDB extends Dexie {
  products!: EntityTable<Product, 'code'>
  sales!: EntityTable<Sale, 'id'>
  purchases!: EntityTable<Purchase, 'id'>
  customers!: EntityTable<Customer, 'id'>
  extras!: EntityTable<Extra, 'id'>
  cierres!: EntityTable<Cierre, 'id'>
  auditLog!: EntityTable<AuditLogEntry, 'id'>
  entradas!: EntityTable<EntradaRecord, 'id'>
  settings!: EntityTable<Settings, 'key'>
  usuarios!: EntityTable<Usuario, 'id'>

  constructor() {
    super('tienda-pro')
    this.version(1).stores({
      products: '&code, cat, brand, esPaquete, esUnidadSuelta',
      sales: '++id, dayKey, date, customerId, payMethod, closedInCierreId',
      purchases: '++id, dayKey, date, closedInCierreId',
      customers: '&id, cedula',
      extras: '++id, dayKey, date, type, closedInCierreId',
      cierres: '++id, fecha',
      auditLog: '++id, date, type, saleId, code',
      entradas: '++id, date, code',
      settings: '&key',
    })
    this.version(2).stores({
      usuarios: '&id, role, active',
    })
  }
}
