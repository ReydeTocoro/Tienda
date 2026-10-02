import { BottomSheet } from '../../../shared/components/BottomSheet'
import { cancelOrder, sendOrder } from '../../../db/repositories/purchaseOrders'
import { CAJA_LABEL } from '../../../shared/lib/cash'
import { formatDateTime, formatMoney, formatQty } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import { ORDER_STATUS } from '../lib/orderStatus'
import { termsLabel } from '../lib/terms'

interface OrderDetailSheetProps {
  order: PurchaseOrder | null
  onClose: () => void
  onEditDraft: (o: PurchaseOrder) => void
  onReceive: (o: PurchaseOrder) => void
}

export function OrderDetailSheet({ order, onClose, onEditDraft, onReceive }: OrderDetailSheetProps) {
  const confirm = useConfirm()

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    try {
      await fn()
      toast(okMsg, 'green')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }

  async function cancel(o: PurchaseOrder) {
    const ok = await confirm({ message: `¿Cancelar el pedido ${formatOrderId(o.id)} a ${o.supplierName}?`, danger: true, confirmLabel: 'Cancelar pedido' })
    if (ok) await act(() => cancelOrder(o.id!), 'Pedido cancelado')
  }

  return (
    <BottomSheet open={!!order} onClose={onClose} maxWidthClass="max-w-[560px]">
      {order && (
        <>
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <div className="font-display text-[18px] font-bold">Pedido {formatOrderId(order.id)}</div>
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${ORDER_STATUS[order.status].cls}`}>{ORDER_STATUS[order.status].label}</span>
          </div>
          <div className="mb-3.5 text-[12px] text-muted">
            {order.supplierName} · {termsLabel(order.paymentTerms)}
            <br />
            Creado {formatDateTime(order.createdAt)}
            {order.orderedAt && ` · Enviado ${formatDateTime(order.orderedAt)}`}
            {order.receivedAt && ` · Recibido ${formatDateTime(order.receivedAt)}`}
          </div>

          <div className="mb-3 overflow-hidden rounded-xl border border-br">
            {order.lines.map((l) => (
              <div key={l.code} className="flex items-center justify-between gap-3 border-b border-br px-3 py-2 text-[13px] last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{l.name}</div>
                  <div className="text-[11px] text-muted">
                    {order.status === 'recibido' ? `${formatQty(l.qtyReceived ?? 0)} recibidos de ${formatQty(l.qty)}` : `${formatQty(l.qty)} × ${formatMoney(l.unitCost)}`}
                  </div>
                </div>
                <div className="flex-shrink-0 font-mono font-semibold">{formatMoney((order.status === 'recibido' ? (l.qtyReceived ?? 0) : l.qty) * l.unitCost)}</div>
              </div>
            ))}
          </div>

          <div className="mb-3 flex items-center justify-between rounded-lg bg-s2 px-3 py-2.5">
            <span className="text-[13px] text-txt2">{order.status === 'recibido' ? 'Total recibido' : 'Total del pedido'}</span>
            <span className="font-mono text-[18px] font-bold text-lime">{formatMoney(order.status === 'recibido' ? (order.receivedTotal ?? order.total) : order.total)}</span>
          </div>

          {order.payment && order.payment.mode !== 'ninguno' && (
            <div className="mb-3 rounded-lg bg-s2 px-3 py-2.5 text-[12px] text-txt2">
              {order.payment.mode === 'contado' ? `Pagado de contado desde ${CAJA_LABEL[order.payment.caja]}.` : 'Quedó como cuenta por pagar (ver pestaña "Por pagar").'}
            </div>
          )}
          {order.notes && <div className="mb-3 text-[12px] text-txt2">Notas: {order.notes}</div>}

          <div className="flex flex-wrap gap-2">
            <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
              Cerrar
            </button>
            {order.status === 'borrador' && (
              <>
                <button onClick={() => onEditDraft(order)} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] font-semibold text-txt2 hover:bg-s2">
                  Editar
                </button>
                <button onClick={() => act(() => sendOrder(order.id!), 'Pedido enviado')} className="flex-[1.5] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-bg">
                  Enviar pedido
                </button>
              </>
            )}
            {order.status === 'pedido' && (
              <button onClick={() => onReceive(order)} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-bg">
                Marcar como recibido
              </button>
            )}
            {(order.status === 'borrador' || order.status === 'pedido') && (
              <button onClick={() => cancel(order)} className="rounded-[10px] border border-red/30 px-3 py-2.5 text-[13px] font-semibold text-red hover:bg-red/10">
                Cancelar pedido
              </button>
            )}
          </div>
        </>
      )}
    </BottomSheet>
  )
}
