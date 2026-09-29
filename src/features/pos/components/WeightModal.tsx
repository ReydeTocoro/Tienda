import { useMemo, useState } from 'react'
import type { Product } from '../../../types/product'
import { getUnitConversions, convert } from '../../../types/unit'
import { unitShortLabel } from '../../../shared/lib/units'
import { formatMoney, formatQty } from '../../../shared/lib/currency'
import { NumericKeypad } from '../../../shared/components/NumericKeypad'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { useCartStore } from '../../../store/useCartStore'
import { toast } from '../../../store/useToastStore'

interface WeightModalProps {
  product: Product
  editIndex: number | null
  onClose: () => void
}

/** "Producto por peso/medida" entry — legacy `openWeightModal`/`confirmWeightItem`
 * (index.html L2559-2754). */
export function WeightModal({ product: p, editIndex, onClose }: WeightModalProps) {
  const baseUnit = p.unit || 'kg'
  const [val, setVal] = useState('0')
  const [unit, setUnit] = useState(baseUnit)
  const addWeightedItem = useCartStore((s) => s.addWeightedItem)

  const conversions = useMemo(() => getUnitConversions(baseUnit), [baseUnit])
  const pricePer = p.price || 0

  const raw = parseFloat(val) || 0
  const qtyInBase = unit === baseUnit ? raw : convert(raw, unit, baseUnit) ?? raw
  const total = qtyInBase * pricePer

  function pressKey(k: string) {
    setVal((s) => {
      if (k === '⌫') return s.length <= 1 ? '0' : s.slice(0, -1)
      if (k === '.') return s.includes('.') ? s : s + '.'
      return s === '0' ? k : s + k
    })
  }

  function confirm() {
    if (raw <= 0) {
      toast('⚠ Ingresa una cantidad', 'orange')
      return
    }
    const qtyRounded = parseFloat(qtyInBase.toFixed(4))
    addWeightedItem(
      { code: p.code, name: p.name, price: pricePer, cost: p.cost, qty: qtyRounded, brand: p.brand, unit: baseUnit, isFree: false },
      editIndex,
    )
    toast(`✓ ${formatQty(raw)} ${unitShortLabel(unit)} de ${p.name} agregado`, 'lime')
    onClose()
  }

  return (
    <BottomSheet open onClose={onClose} maxWidthClass="max-w-[420px]">
      <div className="pb-8 md:pb-0">
        <div className="mb-3.5 flex items-start justify-between">
          <div>
            <div className="font-display text-[17px] font-bold leading-tight">{p.name}</div>
            {p.brand && (
              <div className="mt-0.5 text-[11px] text-muted">
                {p.brand}
                {p.cat ? ' · ' + p.cat : ''}
              </div>
            )}
          </div>
          <div className="ml-3 flex-shrink-0 text-right">
            <div className="font-mono text-[16px] font-bold text-lime">
              {formatMoney(pricePer)}
              <span className="text-[11px] font-normal text-muted">/{unitShortLabel(baseUnit)}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted">
              Stock: {formatQty(p.stock)} {unitShortLabel(baseUnit)}
            </div>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2.5 rounded-[14px] border border-lime bg-s2 px-4 py-3.5">
          <div>
            <div className="mb-1 field-label">Cantidad</div>
            <div className="font-mono text-[32px] font-bold leading-none">{val}</div>
          </div>
          <div className="text-right">
            <div className="mb-1 field-label">Unidad</div>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="rounded-lg border border-br2 bg-s3 px-2.5 py-1.5 font-mono text-[14px] font-bold text-lime outline-none"
            >
              <option value={baseUnit}>{unitShortLabel(baseUnit)}</option>
              {conversions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3.5 flex items-center justify-between rounded-[10px] bg-s2 px-4 py-2.5">
          <span className="text-[13px] text-muted">Total a cobrar</span>
          <span className="font-mono text-[22px] font-bold text-lime">{formatMoney(total)}</span>
        </div>

        <div className="mb-3.5">
          <NumericKeypad onKey={pressKey} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button onClick={onClose} className="rounded-[10px] border border-br2 py-3 text-[13px] font-semibold text-txt2">
            Cancelar
          </button>
          <button onClick={confirm} className="col-span-2 rounded-[10px] bg-lime py-3 text-[15px] font-bold text-black">
            ✓ {editIndex !== null ? 'Actualizar' : 'Agregar al carrito'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
