import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { addExtra } from '../../../db/repositories/extras'
import type { ExtraType } from '../../../types/extra'
import { toast } from '../../../store/useToastStore'

interface ExtraFormSheetProps {
  open: boolean
  onClose: () => void
}

/** legacy `saveExtra()` (index.html L5089-5098). */
export function ExtraFormSheet({ open, onClose }: ExtraFormSheetProps) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<ExtraType>('egreso')

  async function save() {
    const d = desc.trim()
    const amt = parseFloat(amount) || 0
    if (!d || !amt) {
      toast('⚠ Completa los campos', 'orange')
      return
    }
    await addExtra(d, amt, type)
    setDesc('')
    setAmount('')
    setType('egreso')
    onClose()
    toast('✓ Registrado', 'default')
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <p className="mb-3.5 font-display text-[18px] font-bold">Registrar Movimiento</p>
      <div className="mb-2.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Descripción</label>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Pago luz, Flete, ingreso extra..." />
      </div>
      <div className="mb-2.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Monto</label>
        <input className="input" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Tipo</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as ExtraType)}>
          <option value="egreso">↓ Egreso (Gasto)</option>
          <option value="ingreso">↑ Ingreso</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={save} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[13px] font-bold text-black">
          Registrar
        </button>
      </div>
    </BottomSheet>
  )
}
