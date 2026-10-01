import { useState } from 'react'
import { Modal } from '../../../shared/components/Modal'
import { formatMoney } from '../../../shared/lib/currency'

interface AbonoModalProps {
  open: boolean
  maxDebt: number
  onClose: () => void
  onConfirm: (amount: number, note: string) => void
}

/** legacy `abonarFiado()` (index.html L4919-4951). */
export function AbonoModal({ open, maxDebt, onClose, onConfirm }: AbonoModalProps) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  if (!open) return null

  function confirm() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0 || amt > maxDebt) return
    onConfirm(amt, note.trim())
    setAmount('')
    setNote('')
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="mb-1 font-display text-[18px] font-bold">Registrar Abono</div>
      <div className="mb-4 text-[12px] text-muted">
        Deuda total: <b className="text-red">{formatMoney(maxDebt)}</b>
      </div>
      <label className="mb-1 block field-label">Monto del abono *</label>
      <input className="input mb-2.5 border-lime" type="number" min={0.01} max={maxDebt} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
      <div className="mb-3.5 flex flex-wrap gap-1.5">
        <button onClick={() => setAmount(maxDebt.toFixed(2))} className="rounded-lg border border-green/25 bg-green/10 px-2.5 py-1 text-[12px] font-semibold text-green">
          Total {formatMoney(maxDebt)}
        </button>
        <button onClick={() => setAmount((maxDebt / 2).toFixed(2))} className="rounded-lg border border-blue/25 bg-blue/10 px-2.5 py-1 text-[12px] text-blue">
          Mitad {formatMoney(maxDebt / 2)}
        </button>
      </div>
      <label className="mb-1 block field-label">Nota del abono (opcional)</label>
      <input className="input mb-4" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: Efectivo, transferencia..." />
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={confirm} className="flex-[2] rounded-[10px] bg-green py-2.5 text-[14px] font-bold text-black">
          Registrar Abono
        </button>
      </div>
    </Modal>
  )
}
