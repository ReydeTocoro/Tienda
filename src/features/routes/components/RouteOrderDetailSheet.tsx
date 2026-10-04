import { BottomSheet } from '../../../shared/components/BottomSheet'
import { cancelRouteOrder, markRouteOrderPrepared, reopenRouteOrder } from '../../../db/repositories/routeOrders'
import { formatDateTime, formatMoney, formatQty } from '../../../shared/lib/currency'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import type { RouteOrder } from '../../../types/routeOrder'
import { ROUTE_ORDER_STATUS } from '../lib/routeOrderStatus'
import { draftTotal } from '../lib/routeOrderDraft'

interface RouteOrderDetailSheetProps {
  order: RouteOrder | null
  onClose: () => void
  onEdit: (o: RouteOrder) => void
  onDeliver: (o: RouteOrder) => void
  onViewReceipt: (saleId: number) => void
}

export function RouteOrderDetailSheet({ order, onClose, onEdit, onDeliver, onViewReceipt }: RouteOrderDetailSheetProps) {
  const confirm = useConfirm()

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    try {
      await fn()
      toast(okMsg, 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }

  async function cancel(o: RouteOrder) {
    const ok = await confirm({ message: `¿Cancelar el pedido de ${o.customerName}?`, danger: true, confirmLabel: 'Cancelar pedido' })
    if (ok) {
      await act(() => cancelRouteOrder(o.id!), 'Pedido cancelado')
      onClose()
    }
  }

  return (
    <BottomSheet open={!!order} onClose={onClose} maxWidthClass="max-w-[520px]">
      {order && (
        <>
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <div className="font-display text-[18px] font-bold">{order.customerName}</div>
            <span className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${ROUTE_ORDER_STATUS[order.status].cls}`}>{ROUTE_ORDER_STATUS[order.status].label}</span>
          </div>
          <div className="mb-3.5 text-[12px] text-muted">
            Tomado {formatDateTime(order.createdAt)}
            {order.preparedAt && ` · Preparado ${formatDateTime(order.preparedAt)}`}
            {order.deliveredAt && ` · Entregado ${formatDateTime(order.deliveredAt)}`}
          </div>

          <div className="mb-3 overflow-hidden rounded-xl border border-br">
            {order.items.map((i) => (
              <div key={i.code} className="flex items-center justify-between gap-3 border-b border-br px-3 py-2 text-[13px] last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{i.name}</div>
                  <div className="text-[11px] text-muted">
                    {formatQty(i.qty)} {i.unit} × {formatMoney(i.price)}
                  </div>
                </div>
                <div className="flex-shrink-0 font-mono font-semibold">{formatMoney(i.price * i.qty)}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex items-center justify-between rounded-lg bg-s2 px-3 py-2.5">
            <span className="text-[13px] text-txt2">Total del pedido</span>
            <span className="font-mono text-[18px] font-bold text-lime">{formatMoney(draftTotal(order.items))}</span>
          </div>

          {order.notes && <div className="mb-3 text-[12px] text-txt2">Notas: {order.notes}</div>}

          <div className="flex flex-wrap gap-2">
            <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
              Cerrar
            </button>

            {(order.status === 'tomado' || order.status === 'preparado') && (
              <>
                <button onClick={() => onEdit(order)} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] font-semibold text-txt2 hover:bg-s2">
                  Editar
                </button>
                {order.status === 'tomado' ? (
                  <button onClick={() => act(() => markRouteOrderPrepared(order.id!), 'Pedido marcado como preparado')} className="flex-[1.5] rounded-[10px] border border-orange/30 bg-orange/10 py-2.5 text-[13px] font-bold text-orange">
                    Marcar preparado
                  </button>
                ) : (
                  <button onClick={() => act(() => reopenRouteOrder(order.id!), 'Pedido reabierto')} className="flex-[1.5] rounded-[10px] border border-blue/30 bg-blue/10 py-2.5 text-[13px] font-bold text-blue">
                    Reabrir
                  </button>
                )}
                <button onClick={() => onDeliver(order)} className="w-full rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid">
                  Entregar y cobrar
                </button>
                <button onClick={() => cancel(order)} className="w-full rounded-[10px] border border-red/30 py-2.5 text-[13px] font-semibold text-red hover:bg-red/10">
                  Cancelar pedido
                </button>
              </>
            )}

            {order.status === 'entregado' && order.saleId !== undefined && (
              <button onClick={() => onViewReceipt(order.saleId!)} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid">
                Ver recibo
              </button>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  )
}
