/* The steps of the "two tabs / old database / big queue" browser checks (runModule.mjs): the page runs nothing by itself,
 * each step is a function of `window.__check` that the runner calls through the browser, tab by tab. Never the Supabase
 * data: the API behind it is the in-memory one of apiServer.ts. */
import Dexie from 'dexie'
import { db } from '../../../src/db'
import { outboxCounts, saveSaleOffline } from '../../../src/offline/outbox'
import { processOutbox } from '../../../src/offline/outboxSync'
import { newClientId } from '../../../src/shared/lib/id'
import { useConnectionStore } from '../../../src/store/useConnectionStore'
import type { Product } from '../../../src/types/product'

const PRODUCTS: Product[] = [
  { code: 'A1', name: 'Balde', price: 2000, price2: 1800, stock: 50, min: 0, cat: '', brand: '', unit: 'unidad', esPaquete: false },
  { code: 'B2', name: 'Ponchera', price: 5000, stock: 3, min: 0, cat: '', brand: '', unit: 'unidad', esPaquete: false },
  { code: 'C3', name: 'Cuerda', price: 4000, stock: 20, min: 0, cat: '', brand: '', unit: 'm', esPaquete: false },
]

const check = {
  /** Before anything opens the app's database: the database as an older version of the app left it on a device that
   * already works (version 6, with data), then the app's own database opening over it (version 7 adds the outbox). */
  async upgradeFromV6() {
    const old = new Dexie('tienda-pro')
    old.version(1).stores({
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
    old.version(2).stores({ usuarios: '&id, role, active' })
    old.version(3).stores({
      purchases: null,
      extras: null,
      cashMovements: '++id, dayKey, caja, type, sessionId',
      cashSessions: '++id, status, dayKey',
      suppliers: '&id, active',
      purchaseOrders: '++id, supplierId, status',
      payables: '++id, supplierId, orderId, dueDate',
    })
    old.version(4).stores({ routeOrders: '++id, status, customerId' })
    old.version(5).stores({ routeOrders: null })
    old.version(6).stores({ cashMovements: null, cashSessions: null, cierres: null, suppliers: null, purchaseOrders: null, payables: null, cajaState: '&key' })
    await old.table('products').bulkPut(PRODUCTS)
    await old.table('sales').add({ items: [], subtotal: 0, discount: 0, total: 1234, payMethod: 'efectivo', date: '2026-10-01T10:00:00.000Z', dayKey: '2026-10-01' })
    await old.table('settings').put({ key: 'main', storeName: 'Tienda vieja' })
    const oldVersion = old.verno
    old.close()
    await db.open()
    return {
      oldVersion,
      newVersion: db.verno,
      tables: db.tables.map((t) => t.name).sort(),
      products: await db.products.count(),
      sales: await db.sales.count(),
      storeName: ((await db.settings.get('main')) as { storeName?: string } | undefined)?.storeName,
      outbox: await db.outbox.count(),
    }
  },
  /** An empty outbox and the three products. */
  async seed() {
    await db.outbox.clear()
    await db.sales.clear()
    await db.products.clear()
    await db.products.bulkPut(PRODUCTS.map((p) => ({ ...p })))
    useConnectionStore.getState().setReachable(true)
  },
  /** `n` sales of `qty` of `code`, kept as if the internet were down. */
  async enqueue(n: number, code = 'C3', qty = 0.05) {
    const p = PRODUCTS.find((x) => x.code === code)!
    for (let i = 0; i < n; i++) {
      const items = [{ code, name: p.name, price: p.price, qty, brand: '', unit: p.unit, isFree: false }]
      const total = p.price * qty
      await saveSaleOffline({ clientId: newClientId(), items, subtotal: total, discount: 0, total, payMethod: 'efectivo' })
    }
    return outboxCounts()
  },
  send: (wait: boolean) => processOutbox({ force: true, wait }),
  counts: () => outboxCounts(),
  stock: async (code: string) => (await db.products.get(code))?.stock,
}

declare global {
  interface Window {
    __check: typeof check
  }
}
window.__check = check
document.title = 'listo'
