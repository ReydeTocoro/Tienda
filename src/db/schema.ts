import Dexie, { type EntityTable } from 'dexie'
import type { Product } from '../types/product'
import type { Sale } from '../types/sale'
import type { Customer } from '../types/customer'
import type { Cierre } from '../types/cierre'
import type { AuditLogEntry } from '../types/auditLog'
import type { EntradaRecord } from '../types/entrada'
import type { Settings } from '../types/settings'
import type { Usuario } from '../types/usuario'
import type { CashMovement, CashSession } from '../types/cash'
import type { Supplier } from '../types/supplier'
import type { PurchaseOrder, Payable } from '../types/purchaseOrder'
import type { RouteOrder } from '../types/routeOrder'

export class TiendaDB extends Dexie {
  products!: EntityTable<Product, 'code'>
  sales!: EntityTable<Sale, 'id'>
  customers!: EntityTable<Customer, 'id'>
  cierres!: EntityTable<Cierre, 'id'>
  auditLog!: EntityTable<AuditLogEntry, 'id'>
  entradas!: EntityTable<EntradaRecord, 'id'>
  settings!: EntityTable<Settings, 'key'>
  usuarios!: EntityTable<Usuario, 'id'>
  cashMovements!: EntityTable<CashMovement, 'id'>
  cashSessions!: EntityTable<CashSession, 'id'>
  suppliers!: EntityTable<Supplier, 'id'>
  purchaseOrders!: EntityTable<PurchaseOrder, 'id'>
  payables!: EntityTable<Payable, 'id'>
  routeOrders!: EntityTable<RouteOrder, 'id'>

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
    // v4: Rutas — pedidos taken on a delivery round (src/types/routeOrder.ts).
    this.version(4).stores({
      routeOrders: '++id, status, customerId',
    })
  }
}
