import { useState } from 'react'
import { getSale } from '../../db/repositories/sales'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import type { RouteOrder } from '../../types/routeOrder'
import type { Sale } from '../../types/sale'
import { RouteOrderList } from './components/RouteOrderList'
import { TakeOrderView } from './components/TakeOrderView'

type Tab = 'pedidos' | 'nuevo'

/** Rutas: pedidos taken on a delivery round ("recorrido") — visit a business, write down what
 * they want, go back to the shop and pack it, then deliver and charge. Replaces paper and pencil;
 * delivering reuses the exact same checkout/fiado machinery as the POS screen (see DeliverSheet).
 * `h-full` + internal scroll regions only (same chain as VentaPage) so "Tomar pedido" never
 * requires scrolling the page to reach its button — only `vh`-sized content was the earlier bug:
 * `vh` ignores the nav chrome above `main`, `h-full` correctly resolves against the space `main`
 * actually has. */
export function RutasPage() {
  const [tab, setTab] = useState<Tab>('pedidos')
  // `key` forces a fresh draft each time a different pedido (or a new one) is opened for editing.
  const [editing, setEditing] = useState<{ order: RouteOrder | null; key: number }>({ order: null, key: 0 })
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)

  function startOrder(order: RouteOrder | null) {
    setEditing((e) => ({ order, key: e.key + 1 }))
    setTab('nuevo')
  }

  async function viewReceipt(saleId: number) {
    const sale = await getSale(saleId)
    if (sale) setReceiptSale(sale)
  }

  return (
    <div className="flex h-full flex-col p-3.5 md:mx-auto md:w-full md:max-w-[1300px] md:p-5">
      <h1 className="mb-2.5 flex-shrink-0 font-display text-[19px] font-bold md:text-[21px]">Rutas</h1>

      <div className="mb-3 flex flex-shrink-0 gap-1 overflow-x-auto border-b border-br [scrollbar-width:none]">
        <button
          onClick={() => setTab('pedidos')}
          className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-[13px] font-semibold transition-colors ${tab === 'pedidos' ? 'border-lime text-lime' : 'border-transparent text-txt2 hover:text-txt'}`}
        >
          Pedidos
        </button>
        <button
          onClick={() => startOrder(null)}
          className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-[13px] font-semibold transition-colors ${tab === 'nuevo' ? 'border-lime text-lime' : 'border-transparent text-txt2 hover:text-txt'}`}
        >
          Tomar pedido
        </button>
      </div>

      {tab === 'pedidos' && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RouteOrderList
            onEditDraft={startOrder}
            onViewReceipt={viewReceipt}
            onDelivered={(sale) => {
              setTab('pedidos')
              setReceiptSale(sale)
            }}
          />
        </div>
      )}
      {tab === 'nuevo' && (
        <div className="min-h-0 flex-1">
          <TakeOrderView key={editing.key} editing={editing.order} onDone={() => setTab('pedidos')} />
        </div>
      )}

      <ReceiptSheet sale={receiptSale} onClose={() => setReceiptSale(null)} />
    </div>
  )
}
