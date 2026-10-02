export type CajaId = 'menor' | 'mayor'

export type MovementType =
  | 'venta' // cobro de una venta: efectivo → Caja Menor, transferencia → Caja Mayor
  | 'ajuste_venta' // la corrección de una factura cobrada cambió su total
  | 'abono_fiado' // un cliente abonó/pagó un fiado (efectivo → Menor, transferencia → Mayor)
  | 'ingreso' // ingreso manual
  | 'egreso' // egreso manual (gasto menor, nómina, servicios, arriendo...)
  | 'traslado_salida'
  | 'traslado_entrada'
  | 'pago_proveedor' // pago de una compra de contado o de una cuenta por pagar
  | 'ajuste_arqueo' // diferencia encontrada al contar el efectivo (abrir/cerrar caja)

export type ExpenseCategory = 'nomina' | 'servicios' | 'arriendo' | 'proveedores' | 'impuestos' | 'mantenimiento' | 'otro'

/** One line of the append-only cash ledger. A caja's balance is never stored — it is always the
 * sum of its movements, so two devices can't drift apart and every peso has a trail. `amount` is
 * always positive; `direction` says which way it moved. */
export interface CashMovement {
  id?: number
  caja: CajaId
  direction: 'in' | 'out'
  type: MovementType
  amount: number
  concept: string
  category?: ExpenseCategory
  date: string
  /** 'YYYY-MM-DD' in the store's timezone. */
  dayKey: string
  /** Caja Menor session this happened in, when one was open. */
  sessionId?: number
  /** Ties the two halves of a transfer between cajas together. */
  transferId?: string
  /** How the money arrived. Cash goes to the Caja Menor drawer; a bank transfer is credited to the Caja Mayor (safe + banks). */
  medio?: 'efectivo' | 'transferencia'
  refType?: 'sale' | 'purchaseOrder' | 'payable'
  refId?: number | string
  by?: string
  /** Set by a Cierre Z once this movement's day is closed. Row is never deleted. */
  closedInCierreId?: number
}

/** A Caja Menor working day: opened by counting the cash in the drawer, closed by the Cierre Z. */
export interface CashSession {
  id?: number
  status: 'abierta' | 'cerrada'
  dayKey: string
  openedAt: string
  openedBy: string
  /** Cash counted when opening. */
  openingCash: number
  /** What the ledger said the drawer should hold at that moment. */
  systemAtOpen: number
  openDiff: number
  closedAt?: string
  closedBy?: string
  expectedCash?: number
  countedCash?: number
  closeDiff?: number
  /** Amount moved to Caja Mayor when closing. */
  transferred?: number
  cierreId?: number
}
