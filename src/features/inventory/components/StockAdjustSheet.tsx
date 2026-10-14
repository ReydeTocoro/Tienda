import { useState } from 'react'
import { adjustStock } from '../../../db/repositories/products'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { formatQty } from '../../../shared/lib/currency'
import { unitShortLabel } from '../../../shared/lib/units'
import { toast } from '../../../store/useToastStore'
import type { Product } from '../../../types/product'
import { isMeasuredUnit } from '../../../types/unit'

/** Quantities to the gram (the server rounds the same way). */
const roundQty = (n: number) => Math.round(n * 10000) / 10000

/** Reasons a click away, by direction; the text stays editable. */
const REASONS: Record<1 | -1, string[]> = {
  1: ['Llegó mercancía sin pedido', 'Devolución de un cliente', 'Corrección de conteo', 'Apareció en bodega'],
  [-1]: ['Producto dañado o vencido', 'Pérdida o robo', 'Uso interno o regalo', 'Corrección de conteo'],
}

interface StockAdjustSheetProps {
  product: Product | null
  direction: 1 | -1
  onClose: () => void
}

/** The quick − / + of the Stock table: how many and, always, why — the audit trail keeps it with who did it. */
export function StockAdjustSheet({ product, direction, onClose }: StockAdjustSheetProps) {
  return (
    <BottomSheet open={!!product} onClose={onClose} maxWidthClass="max-w-[440px]">
      {product && <AdjustForm product={product} direction={direction} onClose={onClose} />}
    </BottomSheet>
  )
}

function AdjustForm({ product: p, direction, onClose }: { product: Product; direction: 1 | -1; onClose: () => void }) {
  const [qtyText, setQtyText] = useState('1')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const unit = isMeasuredUnit(p.unit) ? unitShortLabel(p.unit) : 'uds'
  const qty = roundQty(parseFloat(qtyText.replace(',', '.')) || 0)
  const before = p.stock || 0
  const after = roundQty(Math.max(0, before + direction * qty))
  const tooMany = direction < 0 && qty > before
  const ready = qty > 0 && !tooMany && reason.trim().length > 0

  async function submit() {
    if (!(qty > 0)) return toast('Indica cuántas unidades', 'orange')
    if (tooMany) return toast(`Solo hay ${formatQty(before)} ${unit}`, 'orange')
    if (!reason.trim()) return toast('Escribe por qué cambias el stock', 'orange')
    setBusy(true)
    try {
      const next = await adjustStock(p.code, direction * qty, reason.trim())
      toast(`${direction > 0 ? '+' : '−'}${formatQty(qty)} ${p.name} → Stock: ${formatQty(next)}`, direction > 0 ? 'green' : 'orange')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2 className="font-display text-[18px] font-bold">{direction > 0 ? 'Sumar al stock' : 'Descontar del stock'}</h2>
      <p className="mt-0.5 truncate text-[13px] text-txt2">
        {p.name} <span className="font-mono text-[11px] text-muted">· {p.code}</span>
      </p>

      <div className="mt-3.5 flex items-end gap-3">
        <label className="w-[110px]">
          <span className="field-label mb-1 block">Cantidad</span>
          <input
            className="input text-right font-mono"
            type="number"
            min={0}
            step={isMeasuredUnit(p.unit) ? 'any' : 1}
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-label="Cantidad"
          />
        </label>
        <div className={`flex-1 rounded-lg px-3 py-2 font-mono text-[14px] ${tooMany ? 'bg-red/10 text-red' : 'bg-s2 text-txt2'}`}>
          {tooMany ? (
            `Solo hay ${formatQty(before)} ${unit}`
          ) : (
            <>
              Stock: {formatQty(before)} → <b className={direction > 0 ? 'text-green' : 'text-orange'}>{formatQty(after)}</b> {unit}
            </>
          )}
        </div>
      </div>

      <label className="mt-3 block">
        <span className="field-label mb-1 block">¿Por qué? *</span>
        <input autoFocus className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Escribe el motivo o elige uno" aria-label="Motivo del ajuste" />
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS[direction].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${reason === r ? 'border-lime bg-lime/10 text-lime' : 'border-br2 text-txt2 hover:bg-s2'}`}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">Queda en la Auditoría del stock con tu nombre, la fecha y el motivo.</p>

      <div className="mt-3.5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button
          data-enter
          disabled={busy || !ready}
          onClick={() => void submit()}
          className={`flex-[2] rounded-[10px] py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-50 ${direction > 0 ? 'bg-green' : 'bg-orange'}`}
        >
          {direction > 0 ? `Sumar ${formatQty(qty)}` : `Descontar ${formatQty(qty)}`}
        </button>
      </div>
    </>
  )
}
