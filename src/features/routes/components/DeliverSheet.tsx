import { useState } from 'react'
import { Banknote, Smartphone, Handshake } from 'lucide-react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { BILLS } from '../../../shared/lib/bills'
import { finalizeSale, addFiadoPago } from '../../../db/repositories/sales'
import { deliverRouteOrder } from '../../../db/repositories/routeOrders'
import { formatMoney } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import type { RouteOrder } from '../../../types/routeOrder'
import type { Sale, PayMethod } from '../../../types/sale'
import { draftTotal } from '../lib/routeOrderDraft'

interface DeliverSheetProps {
  order: RouteOrder | null
  onClose: () => void
  /** The pedido became this Sale — the caller shows its receipt (print/share work unchanged). */
  onDelivered: (sale: Sale) => void
}

const PAY_METHODS: Array<{ key: PayMethod; label: string; icon: typeof Banknote }> = [
  { key: 'efectivo', label: 'Efectivo', icon: Banknote },
  { key: 'transferencia', label: 'Transfer.', icon: Smartphone },
  { key: 'fiado', label: 'Fiado', icon: Handshake },
]

/** "Entregar y cobrar": the one place a pedido turns into money. Charging goes through the exact
 * same `finalizeSale()` the POS checkout uses (stock check, cash ledger, fiado tracking) — this
 * sheet only builds its input from the pedido's items and, on success, links the pedido to the
 * new sale (`deliverRouteOrder`). No discounts/rounding here (v1): the total is always the sum of
 * the pedido's lines, same numbers the business agreed to when the order was taken. */
export function DeliverSheet({ order, onClose, onDelivered }: DeliverSheetProps) {
  return (
    <BottomSheet open={!!order} onClose={onClose} maxWidthClass="max-w-[480px]">
      {order && <DeliverForm order={order} onClose={onClose} onDelivered={onDelivered} />}
    </BottomSheet>
  )
}

function DeliverForm({ order, onClose, onDelivered }: { order: RouteOrder; onClose: () => void; onDelivered: (sale: Sale) => void }) {
  const [payMethod, setPayMethod] = useState<PayMethod>('efectivo')
  const [amountReceived, setAmountReceived] = useState(0)
  const [abono, setAbono] = useState(0)
  const [busy, setBusy] = useState(false)

  const total = draftTotal(order.items)
  const change = amountReceived - total
  const insufficientCash = payMethod === 'efectivo' && amountReceived > 0 && change < 0

  async function confirm() {
    if (insufficientCash) return
    if (payMethod === 'fiado' && abono > total) {
      toast('El abono no puede superar el total', 'orange')
      return
    }
    setBusy(true)
    try {
      const isCash = payMethod === 'efectivo' && amountReceived > 0
      const sale = await finalizeSale({
        items: order.items,
        subtotal: total,
        discount: 0,
        total,
        amountReceived: isCash ? amountReceived : undefined,
        changeGiven: isCash ? amountReceived - total : undefined,
        payMethod,
        customerId: order.customerId,
        customerName: order.customerName,
        fiadoName: payMethod === 'fiado' && !order.customerId ? order.customerName : undefined,
        notes: order.notes,
      })

      // Bookkeeping only from here — the sale above already happened and is never undone by a
      // failure in either of these two calls (see server/domain/routeOrders.ts's doc comment).
      if (payMethod === 'fiado' && abono > 0 && sale.id !== undefined) {
        try {
          await addFiadoPago(sale.id, { amount: abono, date: new Date().toISOString(), note: 'Abono al entregar' })
        } catch (err) {
          toast('Venta registrada, pero el abono no se pudo guardar: ' + (err instanceof Error ? err.message : String(err)), 'orange')
        }
      }
      if (order.id !== undefined && sale.id !== undefined) {
        try {
          await deliverRouteOrder(order.id, sale.id)
        } catch (err) {
          toast('Venta registrada, pero no se pudo marcar el pedido como entregado: ' + (err instanceof Error ? err.message : String(err)), 'orange')
        }
      }
      toast('Pedido entregado y cobrado', 'green')
      onDelivered(sale)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'orange')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-0.5 font-display text-[18px] font-bold">Entregar y cobrar</div>
      <div className="mb-3.5 text-[12px] text-muted">{order.customerName}</div>

      <div className="mb-3.5 max-h-[26vh] overflow-y-auto rounded-xl border border-br">
        {order.items.map((i) => (
          <div key={i.code} className="flex items-center justify-between gap-2 border-b border-br px-3 py-1.5 text-[13px] last:border-b-0">
            <span className="min-w-0 truncate">
              {i.name} <span className="text-muted">×{i.qty}</span>
            </span>
            <span className="flex-shrink-0 font-mono">{formatMoney(i.price * i.qty)}</span>
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex items-center justify-between rounded-lg bg-s2 px-3 py-2.5">
        <span className="text-[13px] font-bold">Total a cobrar</span>
        <span className="font-mono text-[20px] font-bold text-lime">{formatMoney(total)}</span>
      </div>

      <p className="mb-2 field-label">Método de pago</p>
      <div className="mb-3.5 grid grid-cols-3 gap-2">
        {PAY_METHODS.map((m) => (
          <button
            key={m.key}
            onClick={() => setPayMethod(m.key)}
            className={`rounded-xl border-2 py-2.5 text-center transition-colors ${
              payMethod === m.key ? 'border-lime bg-lime/15 text-lime' : 'border-br bg-s1 text-txt2 hover:border-br2 hover:bg-s2 hover:text-txt'
            }`}
          >
            <m.icon size={20} className="mx-auto mb-1" />
            <div className="text-[11px] font-semibold">{m.label}</div>
          </button>
        ))}
      </div>

      {payMethod === 'efectivo' && (
        <div className="mb-3.5">
          <p className="mb-2 field-label">Efectivo recibido</p>
          <MoneyInput placeholder="0" className="input mb-2 text-right font-mono text-[20px] font-bold" value={amountReceived} onChange={(v) => setAmountReceived(v ?? 0)} />
          <div className="mb-2 grid grid-cols-4 gap-1.5">
            {BILLS.map(({ value, img }) => (
              <button
                key={value}
                onClick={() => setAmountReceived(value)}
                aria-label={formatMoney(value)}
                title={formatMoney(value)}
                className={`overflow-hidden rounded-md shadow-xs transition active:scale-[0.96] ${
                  amountReceived === value ? 'ring-2 ring-lime' : 'ring-1 ring-br2 hover:ring-lime/50'
                }`}
              >
                <img src={img} alt="" draggable={false} className="block aspect-[2.2/1] w-full bg-s2 object-contain" />
              </button>
            ))}
            <button onClick={() => setAmountReceived(total)} className="flex aspect-[2.2/1] items-center justify-center rounded-md border border-lime/40 bg-lime/10 text-[12px] font-semibold text-lime">
              Exacto
            </button>
          </div>
          {amountReceived > 0 &&
            (change >= 0 ? (
              <div className="flex items-center justify-between rounded-[10px] bg-green/10 px-3.5 py-2.5">
                <span className="text-[13px] font-semibold text-green">Cambio a devolver</span>
                <span className="font-mono text-[18px] font-bold text-green">{formatMoney(change)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-[10px] bg-red/10 px-3.5 py-2.5">
                <span className="text-[13px] font-semibold text-red">Falta</span>
                <span className="font-mono text-[18px] font-bold text-red">{formatMoney(-change)}</span>
              </div>
            ))}
        </div>
      )}

      {payMethod === 'fiado' && (
        <div className="mb-3.5">
          <p className="mb-2 field-label">¿Te abonaron algo al entregar? (opcional)</p>
          <MoneyInput placeholder="0" className="input text-right font-mono text-[16px] font-bold" value={abono} onChange={(v) => setAbono(v ?? 0)} />
          <div className="mt-1.5 text-[11px] text-muted">El resto (<b className="font-mono">{formatMoney(Math.max(0, total - abono))}</b>) queda fiado a {order.customerName}, en Fiados.</div>
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button
          disabled={busy || insufficientCash}
          onClick={confirm}
          className={`flex-[2] rounded-[10px] py-2.5 text-[14px] font-bold transition-transform active:scale-[0.98] ${
            insufficientCash ? 'cursor-not-allowed bg-br2 text-muted' : 'bg-lime text-on-solid hover:brightness-110 disabled:opacity-60'
          }`}
        >
          {insufficientCash ? `Falta ${formatMoney(-change)}` : 'Confirmar entrega y cobro'}
        </button>
      </div>
    </>
  )
}
