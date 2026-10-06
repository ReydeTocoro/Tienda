import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import { useSecureTable } from '../../db/secure'
import type { PurchaseOrder } from '../../types/purchaseOrder'
import type { PayMethod, Sale } from '../../types/sale'
import { Chip } from '../../shared/components/Chip'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import { SearchInput } from '../../shared/components/SearchInput'
import { formatMoney, todayKey } from '../../shared/lib/currency'
import { nextSort, type SortState } from '../../shared/lib/sortRows'
import { OrderDetailSheet } from '../suppliers/components/OrderDetailSheet'
import { usePermission } from '../pin/usePermission'
import { CorrectionModal } from './components/CorrectionModal'
import { InvoiceTable } from './components/InvoiceTable'
import {
  buildInvoiceRows,
  DEFAULT_INVOICE_SORT,
  filterInvoices,
  INVOICE_PERIODS,
  METHOD_LABEL,
  sortInvoices,
  type InvoiceKind,
  type InvoicePeriod,
  type InvoiceSortKey,
} from './lib/invoiceRows'

const SALE_METHODS: PayMethod[] = ['efectivo', 'transferencia', 'fiado']

export function FacturasPage() {
  const sales = useLiveQuery(() => db.sales.toArray(), [], []) as Sale[]
  // Purchase invoices only reach this device for whoever may see purchase prices.
  const allOrders = useSecureTable('purchaseOrders')
  const orders = useMemo(() => allOrders.filter((o) => o.status === 'recibido'), [allOrders])
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [correctingSale, setCorrectingSale] = useState<Sale | null>(null)
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'todas' | InvoiceKind>('todas')
  const [method, setMethod] = useState<'todos' | PayMethod>('todos')
  const [period, setPeriod] = useState<InvoicePeriod>('todo')
  const [sort, setSort] = useState<SortState<InvoiceSortKey>>(DEFAULT_INVOICE_SORT)
  const { can, requirePermission } = usePermission()
  // Purchase invoices show what each product cost: only for whoever may see purchase prices.
  const canSeePurchases = can('costos.ver')

  async function requestCorrection(sale: Sale) {
    const ok = await requirePermission('facturas.corregir', 'Corregir factura', 'Cambiar una venta ya hecha requiere permiso.')
    if (!ok) return
    setCorrectingSale(sale)
    setReceiptSale(null)
  }

  const all = useMemo(() => buildInvoiceRows(sales, canSeePurchases ? orders : []), [sales, orders, canSeePurchases])
  const today = todayKey()
  const shownKind = canSeePurchases ? kind : 'todas'
  const rows = useMemo(
    () => sortInvoices(filterInvoices(all, { search, kind: shownKind, method, period }, today), sort),
    [all, search, shownKind, method, period, today, sort],
  )

  // Totals of what the filters leave on screen, like the sum in a spreadsheet's status bar.
  const totals = useMemo(() => {
    let ventas = 0
    let compras = 0
    let nVentas = 0
    let nCompras = 0
    for (const r of rows) {
      if (r.kind === 'venta') {
        ventas += r.total
        nVentas++
      } else {
        compras += r.total
        nCompras++
      }
    }
    return { ventas, compras, nVentas, nCompras }
  }, [rows])

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 p-3.5 md:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-[21px] font-bold md:text-[22px]">Facturas</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <Chip>
              {rows.length} factura{rows.length !== 1 ? 's' : ''}
            </Chip>
            {totals.nVentas > 0 && <Chip tone="green">Ventas {formatMoney(totals.ventas)}</Chip>}
            {totals.nCompras > 0 && <Chip tone="red">Compras {formatMoney(totals.compras)}</Chip>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder={canSeePurchases ? 'Buscar número, cliente, proveedor o producto...' : 'Buscar número, cliente o producto...'} />
          {canSeePurchases && (
            <select value={kind} onChange={(e) => setKind(e.target.value as 'todas' | InvoiceKind)} aria-label="Filtrar por tipo" className="input w-auto py-2">
              <option value="todas">Ventas y compras</option>
              <option value="venta">Solo ventas</option>
              <option value="compra">Solo compras</option>
            </select>
          )}
          <select value={method} onChange={(e) => setMethod(e.target.value as 'todos' | PayMethod)} aria-label="Filtrar por forma de pago" className="input w-auto py-2">
            <option value="todos">Todos los pagos</option>
            {SALE_METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
          <select value={period} onChange={(e) => setPeriod(e.target.value as InvoicePeriod)} aria-label="Filtrar por período" className="input w-auto py-2">
            {Object.entries(INVOICE_PERIODS).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
            {all.length === 0 ? 'Sin facturas aún — se crean al vender.' : 'Ninguna factura coincide con la búsqueda o los filtros.'}
          </div>
        ) : (
          <InvoiceTable
            rows={rows}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            resetKey={`${search}|${shownKind}|${method}|${period}|${sort.key}|${sort.dir}`}
            onViewSale={setReceiptSale}
            onCorrectSale={requestCorrection}
            onViewOrder={setViewOrder}
            withPurchases={canSeePurchases}
          />
        )}
      </div>

      <ReceiptSheet sale={receiptSale} onClose={() => setReceiptSale(null)} onCorrect={receiptSale ? () => requestCorrection(receiptSale) : undefined} />
      <CorrectionModal sale={correctingSale} onClose={() => setCorrectingSale(null)} onCorrected={() => setCorrectingSale(null)} />
      {/* Only received orders are listed here, which have no edit/receive actions to offer. */}
      <OrderDetailSheet order={viewOrder} onClose={() => setViewOrder(null)} onEditDraft={() => undefined} onReceive={() => undefined} />
    </div>
  )
}
