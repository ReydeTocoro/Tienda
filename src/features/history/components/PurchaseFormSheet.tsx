import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { savePurchase } from '../../../db/repositories/purchases'
import { toast } from '../../../store/useToastStore'

interface PurchaseFormSheetProps {
  open: boolean
  onClose: () => void
}

/** Register a supplier purchase — legacy `savePurchase()` (index.html L4556-4566). */
export function PurchaseFormSheet({ open, onClose }: PurchaseFormSheetProps) {
  const [provider, setProvider] = useState('')
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')

  async function save() {
    const d = desc.trim()
    const amt = parseFloat(amount) || 0
    if (!d || !amt) {
      toast('⚠ Completa los campos', 'orange')
      return
    }
    await savePurchase({ desc: d, total: amt, provider: provider.trim() || undefined })
    setProvider('')
    setDesc('')
    setAmount('')
    onClose()
    toast('✓ Compra registrada', 'orange')
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <p className="mb-3.5 font-display text-[18px] font-bold">Registrar Compra a Proveedor</p>
      <div className="mb-2.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Proveedor</label>
        <input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Nombre del proveedor" />
      </div>
      <div className="mb-2.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Descripción</label>
        <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Qué compraste" />
      </div>
      <div className="mb-3.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Total pagado</label>
        <input className="input" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={save} className="flex-1 rounded-[10px] bg-lime py-2.5 text-[13px] font-bold text-black">
          Guardar
        </button>
      </div>
    </BottomSheet>
  )
}
