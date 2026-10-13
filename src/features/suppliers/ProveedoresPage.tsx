import { useEffect, useMemo, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useSecureTable } from '../../db/secure'
import { useConfirm } from '../../store/useConfirmStore'
import { useOrderDraftStore, type ProveedoresTab } from '../../store/useOrderDraftStore'
import { Chip } from '../../shared/components/Chip'
import { round2 } from '../../shared/lib/cash'
import { formatMoney, todayKey } from '../../shared/lib/currency'
import type { PurchaseOrder } from '../../types/purchaseOrder'
import type { Supplier } from '../../types/supplier'
import { NewOrderView } from './components/NewOrderView'
import { OrderList } from './components/OrderList'
import { PayablesList } from './components/PayablesList'
import { SupplierList } from './components/SupplierList'
import { buildOrderRows } from './lib/orderRows'
import { buildPayableRows, summarizePayables } from './lib/payableRows'
import { buildSupplierRows } from './lib/supplierRows'

type Tab = ProveedoresTab

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Proveedores y compras: who we buy from, what we ask them for, what arrived, and what we owe. The tab and the order
 * being put together live in `useOrderDraftStore`: leaving for another module and coming back finds them as they were. */
export function ProveedoresPage() {
  const tab = useOrderDraftStore((s) => s.tab)
  const setTab = useOrderDraftStore((s) => s.setTab)
  const confirm = useConfirm()
  // `?tab=porpagar` (the notices' "Ver") opens Por pagar — also when it is followed while already on this page.
  const [params] = useSearchParams()
  const location = useLocation()
  useEffect(() => {
    if (params.get('tab') === 'porpagar') setTab('porpagar')
  }, [location.key, params, setTab])
  const orders = useSecureTable('purchaseOrders')
  const payables = useSecureTable('payables')
  const suppliers = useSecureTable('suppliers')
  const today = todayKey()

  const orderRows = useMemo(() => buildOrderRows(orders), [orders])
  const payableRows = useMemo(() => buildPayableRows(payables, today), [payables, today])
  const supplierRows = useMemo(() => buildSupplierRows(suppliers, payables, orders), [suppliers, payables, orders])

  const toReceive = useMemo(() => {
    const sent = orderRows.filter((r) => r.status === 'pedido')
    return { count: sent.length, total: round2(sent.reduce((t, r) => t + r.total, 0)) }
  }, [orderRows])
  const drafts = useMemo(() => orderRows.filter((r) => r.status === 'borrador').length, [orderRows])
  const debt = useMemo(() => summarizePayables(payableRows), [payableRows])
  const inactive = useMemo(() => supplierRows.filter((r) => !r.active).length, [supplierRows])

  /** Opens a saved draft, or a new order for a supplier. What is being put together is never thrown away without asking:
   * the same order (or a new one without a supplier yet) just shows again. */
  async function startOrder(order: PurchaseOrder | null, supplierId: string | null = null) {
    const s = useOrderDraftStore.getState()
    const same = order ? s.editing?.id === order.id : !s.editing && (!s.draft.supplierId || s.draft.supplierId === supplierId)
    if (same) {
      if (supplierId && !s.draft.supplierId) s.dispatch({ type: 'setSupplier', supplierId })
      return setTab('nuevo')
    }
    if (s.draft.lines.length) {
      const ok = await confirm({
        title: 'Hay un pedido sin terminar',
        message: `Tiene ${plural(s.draft.lines.length, 'producto', 'productos')} sin guardar. Si empiezas otro, ese se descarta.`,
        confirmLabel: 'Descartar y empezar otro',
        cancelLabel: 'Seguir con el que tenía',
        danger: true,
      })
      if (!ok) return setTab('nuevo')
    }
    s.start(order, supplierId)
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number; badgeCls?: string }> = [
    { key: 'pedidos', label: 'Pedidos', badge: toReceive.count, badgeCls: 'bg-orange text-on-solid' },
    { key: 'nuevo', label: 'Nuevo pedido' },
    // The accounts still to pay: the same number the Proveedores item of the nav shows.
    { key: 'porpagar', label: 'Por pagar', badge: debt.open, badgeCls: 'bg-red text-on-solid' },
    { key: 'proveedores', label: 'Proveedores' },
  ]

  // The totals beside the title follow the tab, like the chips of the other spreadsheet pages.
  let chips: ReactNode = null
  if (tab === 'pedidos') {
    chips = (
      <>
        <Chip>{plural(orderRows.length, 'pedido', 'pedidos')}</Chip>
        {toReceive.count > 0 && (
          <Chip tone="orange">
            {toReceive.count} por recibir · {formatMoney(toReceive.total)}
          </Chip>
        )}
        {drafts > 0 && <Chip>{plural(drafts, 'borrador', 'borradores')}</Chip>}
      </>
    )
  } else if (tab === 'porpagar') {
    chips = (
      <>
        <Chip tone="lime">Por pagar {formatMoney(debt.owed)}</Chip>
        {debt.overdue > 0 && <Chip tone="red">Vencido {formatMoney(debt.overdue)}</Chip>}
        {debt.soon > 0 && <Chip tone="orange">Vence en 7 días {formatMoney(debt.soon)}</Chip>}
      </>
    )
  } else if (tab === 'proveedores') {
    chips = (
      <>
        <Chip>{plural(supplierRows.length, 'proveedor', 'proveedores')}</Chip>
        {inactive > 0 && <Chip>{plural(inactive, 'inactivo', 'inactivos')}</Chip>}
        {debt.owed > 0 && <Chip tone="orange">Les debes {formatMoney(debt.owed)}</Chip>}
      </>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 p-3.5 md:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-[21px] font-bold md:text-[22px]">Proveedores y compras</h1>
          {chips && <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">{chips}</div>}
        </div>

        <div role="tablist" aria-label="Secciones de proveedores y compras" className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-br [scrollbar-width:none]">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors ${tab === t.key ? 'border-lime text-lime' : 'border-transparent text-txt2 hover:text-txt'}`}
            >
              {t.label}
              {!!t.badge && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[16px] ${t.badgeCls}`}>{t.badge}</span>}
            </button>
          ))}
        </div>

        {tab === 'pedidos' && <OrderList rows={orderRows} onNew={() => setTab('nuevo')} onEditDraft={(o) => void startOrder(o)} />}
        {tab === 'nuevo' && <NewOrderView />}
        {tab === 'porpagar' && <PayablesList rows={payableRows} />}
        {tab === 'proveedores' && <SupplierList rows={supplierRows} onOrder={(s: Supplier) => void startOrder(null, s.id)} />}
      </div>
    </div>
  )
}
