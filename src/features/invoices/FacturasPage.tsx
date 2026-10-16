import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { History } from 'lucide-react'
import { db } from '../../db/index'
import { useSecureTable } from '../../db/secure'
import type { PurchaseOrder } from '../../types/purchaseOrder'
import type { PayMethod, Sale } from '../../types/sale'
import { Chip } from '../../shared/components/Chip'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import { SearchInput } from '../../shared/components/SearchInput'
import { useProfits } from '../../shared/hooks/useSecretFigures'
import { formatMoney, todayKey } from '../../shared/lib/currency'
import { nextSort, type SortState } from '../../shared/lib/sortRows'
import { OrderDetailSheet } from '../suppliers/components/OrderDetailSheet'
import { usePermission } from '../pin/usePermission'
import { CorrectionModal } from './components/CorrectionModal'
import { CorrectionsHistorySheet } from './components/CorrectionsHistorySheet'
import { VoidSheet } from './components/VoidSheet'
import { InvoiceTable } from './components/InvoiceTable'
import {
  buildInvoiceRows,
  DEFAULT_INVOICE_SORT,
  filterInvoices,
  periodBounds,
  INVOICE_PERIODS,
  METHOD_LABEL,
  periodPhrase,
  sortInvoices,
  type InvoiceKind,
  type InvoicePeriod,
  type InvoiceSortKey,
} from './lib/invoiceRows'

const SALE_METHODS: PayMethod[] = ['efectivo', 'transferencia', 'fiado']

export function FacturasPage() {
  // Purchase invoices only reach this device for whoever may see purchase prices.
  const allOrders = useSecureTable('purchaseOrders')
  const orders = useMemo(() => allOrders.filter((o) => o.status === 'recibido'), [allOrders])
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [correctingSale, setCorrectingSale] = useState<Sale | null>(null)
  const [voidingSale, setVoidingSale] = useState<Sale | null>(null)
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<'todas' | InvoiceKind>('todas')
  const [method, setMethod] = useState<'todos' | PayMethod>('todos')
  // Opens on today's invoices. The days behind "Elegir un día" and "Rango de fechas" start on today
  // too, so choosing either keeps today's list until a date is picked.
  const [period, setPeriod] = useState<InvoicePeriod>('hoy')
  const [day, setDay] = useState(todayKey)
  const [from, setFrom] = useState(todayKey)
  const [to, setTo] = useState(todayKey)
  const [sort, setSort] = useState<SortState<InvoiceSortKey>>(DEFAULT_INVOICE_SORT)
  const today = todayKey()
  // Only the sales of the days on screen are read (by the indexed day), not the whole history — which would be
  // read again on every sale that arrives, on every open device. A period with no end reads everything it must.
  const { since, until } = periodBounds({ period, day, from, to }, today)
  const sales = useLiveQuery(
    () => (since === null && until === null ? db.sales.toArray() : db.sales.where('dayKey').between(since ?? '', until ?? '\uffff', true, true).toArray()),
    [since, until],
    [],
  ) as Sale[]
  // How many sales exist at all (a count reads no rows): tells "no invoices yet" from "none on those days".
  const salesEver = useLiveQuery(() => db.sales.count(), [], -1)
  const { can, requirePermission } = usePermission()
  // Purchase invoices show what each product cost: only for whoever may see purchase prices.
  const canSeePurchases = can('costos.ver')
  // What each sale earned: only for whoever may see profits (the figures don't even reach anyone else's device).
  const canSeeProfit = can('ganancias.ver')
  const profits = useProfits().sales

  async function requestCorrection(sale: Sale) {
    const ok = await requirePermission('facturas.corregir', 'Corregir factura', 'Cambiar una venta ya hecha requiere permiso.')
    if (!ok) return
    setCorrectingSale(sale)
    setReceiptSale(null)
  }

  async function requestVoid(sale: Sale) {
    const ok = await requirePermission('facturas.corregir', 'Anular factura', 'Anular una venta ya hecha requiere permiso.')
    if (!ok) return
    setVoidingSale(sale)
    setReceiptSale(null)
  }

  const all = useMemo(() => buildInvoiceRows(sales, canSeePurchases ? orders : [], canSeeProfit ? profits : undefined), [sales, orders, canSeePurchases, canSeeProfit, profits])
  const toReview = useMemo(() => all.filter((r) => r.toReview).length, [all])
  const shownKind = canSeePurchases ? kind : 'todas'
  const rows = useMemo(
    () => sortInvoices(filterInvoices(all, { search, kind: shownKind, method, period, day, from, to }, today), sort),
    [all, search, shownKind, method, period, day, from, to, today, sort],
  )

  // The list opens on today, so an empty one is usually just a day without sales: say which days
  // came up empty (when the dates are all that narrows the list) rather than blame the filters.
  const periodText = periodPhrase({ period, day, from, to }, today)
  const emptyMessage =
    salesEver === 0 && (!canSeePurchases || orders.length === 0)
      ? 'Sin facturas aún — se crean al vender.'
      : periodText && !search.trim() && shownKind === 'todas' && method === 'todos'
        ? `No hay facturas ${periodText}. Cambia la fecha para ver otros días.`
        : 'Ninguna factura coincide con la búsqueda o los filtros.'

  // Totals of what the filters leave on screen, like the sum in a spreadsheet's status bar.
  const totals = useMemo(() => {
    let ventas = 0
    let compras = 0
    let nVentas = 0
    let nCompras = 0
    for (const r of rows) {
      if (r.voided) continue // an annulled invoice is listed but adds to nothing
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
            {/* Sales made without internet that arrived with something that didn't add up (see ReviewNotes). */}
            {toReview > 0 && (
              <button
                onClick={() => setSearch('por revisar')}
                title="Ventas hechas sin internet con observaciones que nadie ha revisado"
                className="rounded-full border border-orange/30 bg-orange/10 px-2.5 py-0.5 font-semibold text-orange"
              >
                {toReview} por revisar
              </button>
            )}
          </div>
          <button
            onClick={() => setHistoryOpen(true)}
            className="ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-br2 bg-s2 px-3 py-1.5 text-[12px] font-semibold text-txt2 transition-colors hover:bg-s3"
          >
            <History size={14} />
            Correcciones y anulaciones
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} historyKey="facturas" placeholder={canSeePurchases ? 'Buscar número, cliente, proveedor o producto...' : 'Buscar número, cliente o producto...'} />
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
          {period === 'dia' && (
            <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} aria-label="Día de las facturas" className="input w-auto py-2" />
          )}
          {period === 'rango' && (
            <>
              <label className="flex items-center gap-1.5 field-label">
                Desde
                <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="input w-auto py-2" />
              </label>
              <label className="flex items-center gap-1.5 field-label">
                Hasta
                <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="input w-auto py-2" />
              </label>
            </>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
            {emptyMessage}
          </div>
        ) : (
          <InvoiceTable
            rows={rows}
            sort={sort}
            onSort={(key) => setSort((s) => nextSort(s, key))}
            resetKey={`${search}|${shownKind}|${method}|${period}|${day}|${from}|${to}|${sort.key}|${sort.dir}`}
            onViewSale={setReceiptSale}
            onCorrectSale={requestCorrection}
            onVoidSale={requestVoid}
            onViewOrder={setViewOrder}
            withPurchases={canSeePurchases}
            withProfit={canSeeProfit}
          />
        )}
      </div>

      <ReceiptSheet
        sale={receiptSale}
        onClose={() => setReceiptSale(null)}
        onCorrect={receiptSale ? () => requestCorrection(receiptSale) : undefined}
        onVoid={receiptSale ? () => requestVoid(receiptSale) : undefined}
      />
      <CorrectionModal sale={correctingSale} onClose={() => setCorrectingSale(null)} onCorrected={() => setCorrectingSale(null)} />
      <VoidSheet sale={voidingSale} onClose={() => setVoidingSale(null)} onVoided={() => setVoidingSale(null)} />
      <CorrectionsHistorySheet open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {/* Only received orders are listed here, which have no edit/receive actions to offer. */}
      <OrderDetailSheet order={viewOrder} onClose={() => setViewOrder(null)} onEditDraft={() => undefined} onReceive={() => undefined} />
    </div>
  )
}
