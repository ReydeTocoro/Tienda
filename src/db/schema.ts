import Dexie, { type EntityTable } from 'dexie'
import type { Product } from '../types/product'
import type { Sale } from '../types/sale'
import type { Customer } from '../types/customer'
import type { AuditLogEntry } from '../types/auditLog'
import type { EntradaRecord } from '../types/entrada'
import type { Settings } from '../types/settings'
import type { Usuario } from '../types/usuario'
import type { CajaState } from '../types/secrets'

export class TiendaDB extends Dexie {
  products!: EntityTable<Product, 'code'>
  sales!: EntityTable<Sale, 'id'>
  customers!: EntityTable<Customer, 'id'>
  auditLog!: EntityTable<AuditLogEntry, 'id'>
  entradas!: EntityTable<EntradaRecord, 'id'>
  settings!: EntityTable<Settings, 'key'>
  usuarios!: EntityTable<Usuario, 'id'>
  cajaState!: EntityTable<CajaState, 'key'>

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
    // v3: the cash ledger, suppliers and purchase orders replace the old free-form `extras`
    // (gastos/ingresos) and `purchases` tables.
    this.version(3).stores({
      purchases: null,
      extras: null,
      cashMovements: '++id, dayKey, caja, type, sessionId',
      cashSessions: '++id, status, dayKey',
      suppliers: '&id, active',
      purchaseOrders: '++id, supplierId, status',
      payables: '++id, supplierId, orderId, dueDate',
    })
    // v4: Rutas — pedidos taken on a delivery round (removed in v5).
    this.version(4).stores({
      routeOrders: '++id, status, customerId',
    })
    // v5: the Rutas module was removed — drop its local mirror.
    this.version(5).stores({
      routeOrders: null,
    })
    // v6: what not everyone may see (the cash ledger, purchasing, cierres; costs and profits are new
    // tables) never touches the disk any more — it lives in memory only (src/db/secure.ts). Dropping
    // these also wipes the copies older versions left on the device. "cajaState" (caja open or not,
    // no amounts) is what everyone gets instead.
    this.version(6).stores({
      cashMovements: null,
      cashSessions: null,
      cierres: null,
      suppliers: null,
      purchaseOrders: null,
      payables: null,
      cajaState: '&key',
    })
  }
}
