import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { registerMovement } from '../../../db/repositories/cash'
import { CAJA_LABEL, CATEGORIES_BY_CAJA, CATEGORY_LABEL } from '../../../shared/lib/cash'
import { formatMoney } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import type { CajaId, ExpenseCategory } from '../../../types/cash'
import { useActorName, useCaja } from '../hooks/useCaja'

interface MovementFormSheetProps {
  open: boolean
  onClose: () => void
  caja?: CajaId
  /** Fixes the caja (e.g. when opened from a caja's own card or from Reporte). */
  lockCaja?: boolean
  direction?: 'in' | 'out'
}

/** Manual income/expense on a caja: petty cash expenses on the Menor, payroll/rent/utilities/
 * supplier payments on the Mayor. Replaces the old free-form "Registrar movimiento". */
export function MovementFormSheet({ open, onClose, caja = 'menor', lockCaja = false, direction = 'out' }: MovementFormSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[440px]">
      <MovementForm onClose={onClose} initialCaja={caja} lockCaja={lockCaja} initialDirection={direction} />
    </BottomSheet>
  )
}

function MovementForm({ onClose, initialCaja, lockCaja, initialDirection }: { onClose: () => void; initialCaja: CajaId; lockCaja: boolean; initialDirection: 'in' | 'out' }) {
  const { menor, mayor } = useCaja()
  const actor = useActorName()
  const [caja, setCaja] = useState<CajaId>(initialCaja)
  const [direction, setDirection] = useState<'in' | 'out'>(initialDirection)
  const [amount, setAmount] = useState(0)
  const [concept, setConcept] = useState('')
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const [busy, setBusy] = useState(false)

  const balance = caja === 'menor' ? menor : mayor
  const categories = CATEGORIES_BY_CAJA[caja]
  const effectiveCategory = category && categories.includes(category) ? category : categories[0]
  const insufficient = direction === 'out' && amount > balance + 0.005

  async function submit() {
    if (!(amount > 0)) {
      toast('Escribe el monto', 'orange')
      return
    }
    if (!concept.trim()) {
      toast('Escribe el concepto', 'orange')
      return
    }
    setBusy(true)
    try {
      await registerMovement({ caja, direction, amount, concept: concept.trim(), category: direction === 'out' ? effectiveCategory : undefined, by: actor })
      toast(direction === 'out' ? 'Egreso registrado' : 'Ingreso registrado', 'green')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const seg = (active: boolean) => `flex-1 rounded-[10px] border py-2 text-[13px] font-semibold transition-colors ${active ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s2'}`

  return (
    <>
      <div className="mb-3.5 font-display text-[18px] font-bold">Registrar movimiento</div>

      <div className="mb-3 flex gap-2">
        <button onClick={() => setDirection('out')} className={seg(direction === 'out')}>
          Egreso (sale dinero)
        </button>
        <button onClick={() => setDirection('in')} className={seg(direction === 'in')}>
          Ingreso (entra dinero)
        </button>
      </div>

      {!lockCaja && (
        <div className="mb-3 flex gap-2">
          {(['menor', 'mayor'] as const).map((c) => (
            <button key={c} onClick={() => setCaja(c)} className={seg(caja === c)}>
              {CAJA_LABEL[c]}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex items-center justify-between rounded-xl bg-s2 px-3.5 py-2 text-[12px]">
        <span className="text-txt2">Saldo de {CAJA_LABEL[caja]}</span>
        <span className="font-mono font-bold">{formatMoney(balance)}</span>
      </div>

      <label className="mb-1 block field-label">Monto *</label>
      <MoneyInput className="input mb-2.5 text-right font-mono text-[20px] font-bold" value={amount} onChange={(v) => setAmount(v ?? 0)} autoFocus />
      {insufficient && <div className="mb-2.5 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">Saldo insuficiente en {CAJA_LABEL[caja]}.</div>}

      <label className="mb-1 block field-label">Concepto *</label>
      <input className="input mb-2.5" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={direction === 'out' ? 'Ej: Pago de luz, hielo, flete...' : 'Ej: Aporte del dueño, consignación...'} />

      {direction === 'out' && (
        <>
          <label className="mb-1 block field-label">Categoría</label>
          <select className="input mb-3.5" value={effectiveCategory} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="mt-3.5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy || insufficient} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-50">
          Registrar
        </button>
      </div>
    </>
  )
}
