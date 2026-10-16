import { useState } from 'react'
import { X } from 'lucide-react'
import { Modal } from '../../../shared/components/Modal'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { useCartStore } from '../../../store/useCartStore'
import { toast } from '../../../store/useToastStore'
import { formatMoney } from '../../../shared/lib/currency'

interface FreeProductModalProps {
  open: boolean
  onClose: () => void
}

/** "Producto sin registrar": something that isn't in the inventory, charged with the name and price typed here.
 * It goes in the cart like any product and never touches the stock. */
export function FreeProductModal({ open, onClose }: FreeProductModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <FreeForm onClose={onClose} />
    </Modal>
  )
}

function FreeForm({ onClose }: { onClose: () => void }) {
  const addFreeItem = useCartStore((s) => s.addFreeItem)
  const [name, setName] = useState('')
  const [price, setPrice] = useState(0)
  const [qty, setQty] = useState('1')
  const units = Number(qty) || 0
  const valid = name.trim() !== '' && price > 0 && units >= 1

  function add() {
    if (!valid) return
    addFreeItem(name.trim().slice(0, 120), price, units)
    toast(`${name.trim()} agregado al carrito`, 'purple')
    onClose()
  }

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <div className="font-display text-[18px] font-bold">Producto sin registrar</div>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>
      <div className="mb-4 text-[12px] text-muted">No está en el inventario: escribe qué es y cuánto vale. No descuenta stock.</div>

      <label htmlFor="free-name" className="mb-1 block field-label">
        Nombre
      </label>
      <input id="free-name" className="input mb-2.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej: Balde especial, servicio…" autoFocus />

      <div className="mb-2.5 grid grid-cols-[1fr_96px] gap-2.5">
        <div>
          <label htmlFor="free-price" className="mb-1 block field-label">
            Precio de una unidad
          </label>
          <MoneyInput id="free-price" className="input text-right font-mono" value={price} onChange={(v) => setPrice(v ?? 0)} placeholder="0" />
        </div>
        <div>
          <label htmlFor="free-qty" className="mb-1 block field-label">
            Cantidad
          </label>
          <input id="free-qty" className="input text-right font-mono" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-[10px] bg-s2 px-3.5 py-2.5">
        <span className="text-[13px] text-muted">Total de la línea</span>
        <span className="font-mono text-[18px] font-semibold text-lime">{formatMoney(price * units)}</span>
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button data-enter disabled={!valid} onClick={add} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-50">
          Agregar al carrito
        </button>
      </div>
    </>
  )
}
