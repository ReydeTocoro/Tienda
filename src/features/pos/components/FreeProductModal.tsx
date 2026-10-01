import { useState } from 'react'
import { Modal } from '../../../shared/components/Modal'
import { useCartStore } from '../../../store/useCartStore'
import { formatMoney } from '../../../shared/lib/currency'

interface FreeProductModalProps {
  open: boolean
  onClose: () => void
  prefillPrice?: number | null
}

/** "Producto libre" — a free-form line item with no stock link (legacy L2918-2992). */
export function FreeProductModal({ open, onClose, prefillPrice }: FreeProductModalProps) {
  const [desc, setDesc] = useState('')
  const [price, setPrice] = useState(prefillPrice ? prefillPrice.toFixed(2) : '')
  const [qty, setQty] = useState('1')
  const addFreeItem = useCartStore((s) => s.addFreeItem)

  if (!open) return null

  const total = (parseFloat(price) || 0) * (parseFloat(qty) || 0)

  function confirm() {
    const d = desc.trim()
    const p = parseFloat(price) || 0
    const q = parseFloat(qty) || 1
    if (!d || !p) return
    addFreeItem(d, p, q)
    setDesc('')
    setPrice('')
    setQty('1')
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="mb-1 font-display text-[18px] font-bold">Producto libre</div>
      <div className="mb-4 text-[12px] text-muted">Sin stock registrado — describe y pon el precio</div>

      <label className="mb-1 block field-label">Descripción *</label>
      <input className="input mb-2.5 border-lime" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej: Servicio, producto especial..." autoFocus />

      <div className="mb-2.5 grid grid-cols-2 gap-2.5">
        <div>
          <label className="mb-1 block field-label">Precio unitario *</label>
          <input className="input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="mb-1 block field-label">Cantidad</label>
          <input className="input" type="number" min={0.001} step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-[10px] bg-s2 px-3.5 py-2.5">
        <span className="text-[13px] text-muted">Total a cobrar</span>
        <span className="font-mono text-[18px] font-semibold text-lime">{formatMoney(total)}</span>
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={confirm} className="flex-[2] rounded-[10px] bg-orange py-2.5 text-[14px] font-bold text-black">
          Agregar al carrito
        </button>
      </div>
    </Modal>
  )
}
