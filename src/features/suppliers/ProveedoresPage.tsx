import { useMemo, useState } from 'react'
import { useSecureTable } from '../../db/secure'
import { payableBalance } from '../../shared/lib/cash'
import { todayKey } from '../../shared/lib/currency'
import type { PurchaseOrder } from '../../types/purchaseOrder'
import { NewOrderView } from './components/NewOrderView'
import { OrderList } from './components/OrderList'
import { PayablesList } from './components/PayablesList'
import { SupplierList } from './components/SupplierList'

type Tab = 'pedidos' | 'nuevo' | 'porpagar' | 'proveedores'

/** Proveedores y compras: who we buy from, what we ask them for, what arrived, and what we owe. */
export function ProveedoresPage() {
  const [tab, setTab] = useState<Tab>('pedidos')
  // `key` forces a fresh draft each time a different order (or a new one) is opened for editing.
  const [editing, setEditing] = useState<{ order: PurchaseOrder | null; key: number }>({ order: null, key: 0 })
  const orders = useSecureTable('purchaseOrders')
  const payables = useSecureTable('payables')
  const toReceive = useMemo(() => orders.filter((o) => o.status === 'pedido').length, [orders])
  const overdue = useMemo(() => {
    const today = todayKey()
    return payables.filter((p) => payableBalance(p) > 0 && p.dueDate < today).length
  }, [payables])

  function startOrder(order: PurchaseOrder | null) {
    setEditing((e) => ({ order, key: e.key + 1 }))
    setTab('nuevo')
  }

  const tabs: Array<{ key: Tab; label: string; badge?: number; badgeCls?: string }> = [
    { key: 'pedidos', label: 'Pedidos', badge: toReceive, badgeCls: 'bg-orange text-on-solid' },
    { key: 'nuevo', label: 'Nuevo pedido' },
    { key: 'porpagar', label: 'Por pagar', badge: overdue, badgeCls: 'bg-red text-on-solid' },
    { key: 'proveedores', label: 'Proveedores' },
  ]

  return (
    <div className="p-3.5 md:mx-auto md:max-w-[1300px] md:p-5">
      <h1 className="mb-3.5 font-display text-[21px] font-bold md:text-[22px]">Proveedores y compras</h1>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-br [scrollbar-width:none]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => (t.key === 'nuevo' ? startOrder(null) : setTab(t.key))}
            className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-[13px] font-semibold transition-colors ${tab === t.key ? 'border-lime text-lime' : 'border-transparent text-txt2 hover:text-txt'}`}
          >
            {t.label}
            {!!t.badge && <span className={`min-w-[18px] rounded-full px-1.5 text-center text-[10px] font-bold leading-[16px] ${t.badgeCls}`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'pedidos' && <OrderList onEditDraft={startOrder} />}
      {tab === 'nuevo' && <NewOrderView key={editing.key} editing={editing.order} onDone={() => setTab('pedidos')} />}
      {tab === 'porpagar' && <PayablesList />}
      {tab === 'proveedores' && <SupplierList />}
    </div>
  )
}
