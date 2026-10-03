import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { receiveOrder } from '../../../db/repositories/purchaseOrders'
import { CAJA_LABEL, dueDateFrom, formatDayKey, round2 } from '../../../shared/lib/cash'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { toast } from '../../../store/useToastStore'
import type { CajaId } from '../../../types/cash'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import { useActorName, useCaja } from '../../cash/hooks/useCaja'
import { termsLabel } from '../lib/terms'

interface ReceiveOrderSheetProps {
  order: PurchaseOrder | null
  onClose: () => void
  onReceived: () => void
}

/** "Marcar como recibido": confirm what really arrived (the only moment stock grows), then say how
 * it is paid — cash out of a caja right now, or an account payable due on the supplier's terms. */
export function ReceiveOrderSheet({ order, onClose, onReceived }: ReceiveOrderSheetProps) {
  return (
    <BottomSheet open={!!order} onClose={onClose} maxWidthClass="max-w-[560px]">
      {order && <ReceiveForm order={order} onClose={onClose} onReceived={onReceived} />}
    </BottomSheet>
  )
}

function ReceiveForm({ order, onClose, onReceived }: { order: PurchaseOrder; onClose: () => void; onReceived: () => void }) {
  const { menor, mayor } = useCaja()
  const actor = useActorName()
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((l) => [l.code, String(l.qty)])))
  const [costs, setCosts] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((l) => [l.code, String(l.unitCost)])))
  const creditAllowed = order.paymentTerms.kind === 'credito'
  const [mode, setMode] = useState<'contado' | 'credito'>(creditAllowed ? 'credito' : 'contado')
  const [caja, setCaja] = useState<CajaId>('mayor')
  const [busy, setBusy] = useState(false)

  const lines = order.lines.map((l) => ({ ...l, qtyReceived: parseFloat(qtys[l.code]) || 0, unitCost: parseFloat(costs[l.code]) || 0 }))
  const total = round2(lines.reduce((t, l) => t + l.qtyReceived * l.unitCost, 0))
  const balances = { menor, mayor }
  const insufficient = mode === 'contado' && total > 0 && balances[caja] + 0.005 < total
  const dueKey = order.paymentTerms.kind === 'credito' ? dueDateFrom(new Date(), order.paymentTerms.days) : null

  async function submit() {
    if (!lines.some((l) => l.qtyReceived > 0)) {
      toast('Indica qué cantidades llegaron', 'orange')
      return
    }
    setBusy(true)
    try {
      await receiveOrder(order.id!, {
        lines: lines.map((l) => ({ code: l.code, qtyReceived: l.qtyReceived, unitCost: l.unitCost })),
        payment: mode === 'contado' ? { mode: 'contado', caja } : { mode: 'credito' },
        by: actor,
      })
      toast(`Pedido ${formatOrderId(order.id)} recibido · stock actualizado`, 'green')
      onReceived()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const choice = (is: boolean) => `flex-1 rounded-xl border-2 p-2.5 text-left transition-colors ${is ? 'border-lime bg-lime/10' : 'border-br hover:border-br2 hover:bg-s2'}`

  return (
    <>
      <div className="mb-0.5 font-display text-[18px] font-bold">Recibir pedido {formatOrderId(order.id)}</div>
      <div className="mb-3.5 text-[12px] text-muted">
        {order.supplierName} · {termsLabel(order.paymentTerms)}
      </div>

      <div className="mb-1 grid grid-cols-[1fr_72px_88px] gap-2 px-1 text-[10px] text-muted">
        <span>Producto (pedido)</span>
        <span className="text-right">Llegó</span>
        <span className="text-right">Costo unit.</span>
      </div>
      <div className="mb-3 max-h-[34vh] overflow-y-auto rounded-xl border border-br">
        {order.lines.map((l) => (
          <div key={l.code} className="grid grid-cols-[1fr_72px_88px] items-center gap-2 border-b border-br px-2.5 py-2 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{l.name}</div>
              <div className="text-[10px] text-muted">pedido: {formatQty(l.qty)}</div>
            </div>
            <input className="input px-2 py-1.5 text-right font-mono text-[13px]" type="number" min={0} step="any" value={qtys[l.code]} onChange={(e) => setQtys((s) => ({ ...s, [l.code]: e.target.value }))} />
            <input className="input px-2 py-1.5 text-right font-mono text-[13px]" type="number" min={0} step="any" value={costs[l.code]} onChange={(e) => setCosts((s) => ({ ...s, [l.code]: e.target.value }))} />
          </div>
        ))}
      </div>

      <div className="mb-3.5 flex items-center justify-between rounded-lg bg-s2 px-3 py-2.5">
        <span className="text-[13px] text-txt2">Total a pagar</span>
        <span className="font-mono text-[20px] font-bold text-lime">{formatMoney(total)}</span>
      </div>

      <div className="mb-2 field-label">¿Cómo se paga?</div>
      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setMode('contado')} className={choice(mode === 'contado')}>
          <div className="text-[13px] font-bold">De contado</div>
          <div className="text-[11px] text-txt2">Sale de una caja ahora</div>
        </button>
        {creditAllowed && (
          <button type="button" onClick={() => setMode('credito')} className={choice(mode === 'credito')}>
            <div className="text-[13px] font-bold">A crédito</div>
            <div className="text-[11px] text-txt2">Cuenta por pagar</div>
          </button>
        )}
      </div>

      {mode === 'contado' ? (
        <>
          <div className="mb-1.5 field-label">¿De dónde sale el dinero?</div>
          <div className="mb-2 flex gap-2">
            {(['mayor', 'menor'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCaja(c)} className={choice(caja === c)}>
                <div className="text-[13px] font-bold">{CAJA_LABEL[c]}</div>
                <div className={`font-mono text-[12px] ${balances[c] + 0.005 < total ? 'text-red' : 'text-txt2'}`}>{formatMoney(balances[c])}</div>
              </button>
            ))}
          </div>
          {insufficient && <div className="mb-2 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">{CAJA_LABEL[caja]} no tiene saldo suficiente. Elige la otra caja o traslada fondos.</div>}
        </>
      ) : (
        <div className="mb-2 rounded-lg bg-blue/10 px-3 py-2.5 text-[12px] text-blue">
          Se crea una cuenta por pagar de <b className="font-mono">{formatMoney(total)}</b> con vencimiento el <b>{dueKey ? formatDayKey(dueKey) : ''}</b> ({order.paymentTerms.kind === 'credito' ? order.paymentTerms.days : 0} días).
        </div>
      )}

      <div className="mt-3.5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy || insufficient} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-50">
          Recibir y registrar
        </button>
      </div>
    </>
  )
}
