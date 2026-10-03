import { useState } from 'react'
import { X } from 'lucide-react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { useCartStore } from '../../../store/useCartStore'
import { toast } from '../../../store/useToastStore'

interface QuickDiscountModalProps {
  open: boolean
  onClose: () => void
}

const PRESETS = [5, 10, 15, 20, 25, 30, 50]

/** Manual % discount over the cart total — legacy `openQuickDiscount()` (index.html L5250-5285). */
export function QuickDiscountModal({ open, onClose }: QuickDiscountModalProps) {
  const [custom, setCustom] = useState('')
  const setManualDiscountPct = useCartStore((s) => s.setManualDiscountPct)

  function apply(pct: number) {
    if (pct < 0 || pct > 100) {
      toast('Porcentaje inválido', 'orange')
      return
    }
    setManualDiscountPct(pct)
    toast(pct > 0 ? `Descuento ${pct}% aplicado` : 'Descuento eliminado', pct > 0 ? 'purple' : 'default')
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[420px]">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="font-display text-[18px] font-bold">% Descuento manual</div>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>
      <div className="mb-3.5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p} onClick={() => apply(p)} className="rounded-lg border border-br2 bg-s2 px-3.5 py-2 font-mono text-[14px] font-bold text-lime">
            {p}%
          </button>
        ))}
      </div>
      <div className="mb-3.5 flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          placeholder="Otro %"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="input flex-1 border-lime font-mono text-lime"
        />
        <button onClick={() => apply(parseFloat(custom) || 0)} className="rounded-[10px] bg-lime px-4.5 py-2.5 text-[15px] font-extrabold text-on-solid">
          Aplicar
        </button>
      </div>
      <button onClick={() => apply(0)} className="w-full py-1.5 text-[13px] text-muted">
        Quitar descuento
      </button>
    </BottomSheet>
  )
}
