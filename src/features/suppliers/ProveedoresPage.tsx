import { useMemo, useState, type ReactNode } from 'react'
import { useSecureTable } from '../../db/secure'
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

type Tab = 'pedidos' | 'nuevo' | 'porpagar' | 'proveedores'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Proveedores y compras: who we buy from, what we ask them for, what arrived, and what we owe. */
export function ProveedoresPage() {
  const [tab, setTab] = useState<Tab>('pedidos')
  // `key` forces a fresh draft each time a different order (or a new one) is opened for editing;
  // `supplierId` is the supplier a new order starts addressed to.
  const [editing, setEditing] = useState<{ order: PurchaseOrder | null; supplierId: string | null; key: number }>({ order: null, supplierId: null, key: 0 })
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
  const overdueCount = useMemo(() => payableRows.filter((r) => r.status === 'vencida').length, [payableRows])
  const inactive = useMemo(() => supplierRows.filter((r) => !r.active).length, [supplierRows])

  function startOrder(order: PurchaseOrder | null, supplierId: string | null = null) {
    setEditing((e) => ({ order, supplierId, key: e.key + 1 }))
    setTab('nuevo')
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number; badgeCls?: string }> = [
    { key: 'pedidos', label: 'Pedidos', badge: toReceive.count, badgeCls: 'bg-orange text-on-solid' },
    { key: 'nuevo', label: 'Nuevo pedido' },
    { key: 'porpagar', label: 'Por pagar', badge: overdueCount, badgeCls: 'bg-red text-on-solid' },
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
              onClick={() => (t.key === 'nuevo' ? startOrder(null) : setTab(t.key))}
              className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors ${tab === t.key ? 'border-lime text-lime' : 'border-transparent text-txt2 hover:text-txt'}`}
            >
              {t.label}
              {!!t.badge && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[16px] ${t.badgeCls}`}>{t.badge}</span>}
            </button>
          ))}
        </div>

        {tab === 'pedidos' && <OrderList rows={orderRows} onNew={() => startOrder(null)} onEditDraft={startOrder} />}
        {tab === 'nuevo' && <NewOrderView key={editing.key} editing={editing.order} supplierId={editing.supplierId} onDone={() => setTab('pedidos')} />}
        {tab === 'porpagar' && <PayablesList rows={payableRows} />}
        {tab === 'proveedores' && <SupplierList rows={supplierRows} onOrder={(s: Supplier) => startOrder(null, s.id)} />}
      </div>
    </div>
  )
}
