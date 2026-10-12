import { useState } from 'react'
import type { Sale } from '../../../types/sale'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { voidSale } from '../../../db/repositories/sales'
import { toast } from '../../../store/useToastStore'
import { formatSaleId } from '../../../shared/lib/id'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { stockEffect } from '../../../shared/lib/saleStock'
import { StockEffectList } from './StockEffectList'

interface VoidSheetProps {
  sale: Sale | null
  onClose: () => void
  onVoided: () => void
}

/** What an annulment does with the money, in words: the same movements `voidSale` books on the server. */
function moneyLines(sale: Sale): string[] {
  const lines: string[] = []
  if (sale.payMethod === 'efectivo' && sale.total > 0) lines.push(`Salen ${formatMoney(sale.total)} de la Caja Menor (se devuelven al cliente).`)
  if (sale.payMethod === 'transferencia' && sale.total > 0) lines.push(`Salen ${formatMoney(sale.total)} de la Caja Mayor (transferencia devuelta).`)
  if (sale.payMethod === 'fiado') {
    lines.push('La deuda de esta factura desaparece del cliente.')
    for (const method of ['efectivo', 'transferencia'] as const) {
      const given = (sale.fiadoPagos || []).filter((p) => !p.condonado && (p.method ?? 'efectivo') === method).reduce((a, p) => a + p.amount, 0)
      if (given > 0) lines.push(`Se devuelven ${formatMoney(given)} de abonos, ${method === 'efectivo' ? 'de la Caja Menor' : 'de la Caja Mayor'}.`)
    }
  }
  return lines.length ? lines : ['No mueve dinero.']
}

/** Annulling a whole invoice. It shows everything that will happen — inventory, money — and asks why. */
export function VoidSheet({ sale, onClose, onVoided }: VoidSheetProps) {
  if (!sale) return null
  return (
    <BottomSheet open onClose={onClose}>
      <VoidForm sale={sale} onClose={onClose} onVoided={onVoided} />
    </BottomSheet>
  )
}

function VoidForm({ sale, onClose, onVoided }: { sale: Sale; onClose: () => void; onVoided: () => void }) {
  const [reason, setReason] = useState('')

  async function confirm() {
    if (!reason.trim()) {
      toast('Escribe el motivo de la anulación', 'orange')
      return
    }
    await voidSale(sale.id!, reason.trim())
    toast(`Factura ${formatSaleId(sale.id)} anulada`, 'orange')
    onVoided()
  }

  return (
    <>
      <div className="mb-1">
        <div className="font-display text-[18px] font-bold">Anular Factura</div>
        <div className="text-[11px] text-muted">
          {formatSaleId(sale.id)} · {formatDateTime(sale.date)} · {formatMoney(sale.total)}
        </div>
      </div>
      <div className="my-3.5 rounded-[10px] border border-red/25 bg-red/10 px-3 py-2.5 text-[12px] text-red">
        La factura queda marcada como <b>anulada</b> y deja de contar en ventas y reportes. No se borra: se puede consultar y queda en el historial de auditoría.
      </div>

      <div className="mb-1 field-label">Qué pasará al anularla</div>
      <div className="mb-3.5 rounded-[10px] border border-br bg-s2 p-2.5 text-[12px]">
        <StockEffectList effect={stockEffect(sale.items, [])} />
        <div className="mt-2 space-y-0.5 border-t border-br pt-2 text-txt2">
          {moneyLines(sale).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
        {sale.closedInCierreId !== undefined && (
          <div className="mt-2 border-t border-br pt-2 text-orange">Es de un día que ya tuvo Cierre Z: ese cierre guardado no cambia, y el dinero se registra hoy.</div>
        )}
      </div>

      <div className="mb-1.5 field-label">Motivo de la anulación *</div>
      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: El cliente devolvió todo, la venta se hizo por error..." className="input resize-none border-lime" autoFocus />

      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button data-enter onClick={confirm} className="flex-[2] rounded-[10px] bg-red py-2.5 text-[14px] font-extrabold text-on-solid">
          Anular factura
        </button>
      </div>
    </>
  )
}
