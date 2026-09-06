import { useEffect, useState } from 'react'
import type { Sale } from '../../../types/sale'
import type { CartItem } from '../../../types/cartItem'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { correctSale } from '../../../db/repositories/sales'
import { toast } from '../../../store/useToastStore'
import { formatSaleId } from '../../../shared/lib/id'
import { formatDateTime } from '../../../shared/lib/currency'

interface CorrectionModalProps {
  sale: Sale | null
  onClose: () => void
  onCorrected: () => void
}

/** legacy `abrirCorreccionVenta()`/`confirmarCorreccion()` (index.html L6924-7073). */
export function CorrectionModal({ sale, onClose, onCorrected }: CorrectionModalProps) {
  const [items, setItems] = useState<CartItem[]>([])
  const [reason, setReason] = useState('')
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newPrice, setNewPrice] = useState('')

  useEffect(() => {
    if (sale) {
      setItems(sale.items.map((i) => ({ ...i })))
      setReason('')
      setNewName('')
      setNewQty('')
      setNewPrice('')
    }
  }, [sale])

  if (!sale) return null

  function updateItem(i: number, field: 'qty' | 'price', value: string) {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, [field]: num } : it)))
  }

  function removeItem(i: number) {
    setItems((s) => s.filter((_, idx) => idx !== i))
  }

  function addItem() {
    const name = newName.trim()
    const qty = parseFloat(newQty) || 0
    const price = parseFloat(newPrice) || 0
    if (!name || !qty || !price) {
      toast('⚠ Completa nombre, cantidad y precio', 'orange')
      return
    }
    setItems((s) => [...s, { code: 'CORR', name, price, cost: 0, qty, brand: '', unit: 'unidad', isFree: true }])
    setNewName('')
    setNewQty('')
    setNewPrice('')
  }

  async function confirm() {
    if (!sale) return
    if (!reason.trim()) {
      toast('⚠ Escribe el motivo de la corrección', 'orange')
      return
    }
    if (!items.length) {
      toast('⚠ La factura no puede quedar sin ítems', 'orange')
      return
    }
    await correctSale(sale.id!, items, reason.trim())
    toast(`✓ Factura ${formatSaleId(sale.id)} corregida`, 'orange')
    onCorrected()
  }

  return (
    <BottomSheet open={!!sale} onClose={onClose} zIndexClass="z-[4000]">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[22px]">✏️</span>
        <div>
          <div className="font-display text-[18px] font-bold">Corregir Factura</div>
          <div className="text-[11px] text-muted">
            {formatSaleId(sale.id)} · {formatDateTime(sale.date)}
          </div>
        </div>
      </div>
      <div className="my-3.5 rounded-[10px] border border-orange/25 bg-orange/10 px-3 py-2.5 text-[12px] text-orange">
        ⚠️ Los cambios quedan en el historial de auditoría. El reporte se recalcula automáticamente.
      </div>

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Productos en la factura</div>
      {items.map((it, i) => (
        <div key={i} className="mb-1.5 grid grid-cols-[1fr_80px_80px_28px] items-center gap-2 border-b border-br pb-1.5">
          <div>
            <div className="text-[13px] font-semibold">{it.name}</div>
            <div className="font-mono text-[10px] text-muted">{it.code || '—'}</div>
          </div>
          <input type="number" min={0} value={it.qty} onChange={(e) => updateItem(i, 'qty', e.target.value)} className="input py-1.5 text-right font-mono text-[13px]" />
          <input type="number" min={0} step="0.01" value={it.price} onChange={(e) => updateItem(i, 'price', e.target.value)} className="input py-1.5 text-right font-mono text-[13px]" />
          <button onClick={() => removeItem(i)} className="text-[15px] text-red">
            ✕
          </button>
        </div>
      ))}

      <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">Agregar producto</div>
      <div className="mb-1.5 grid grid-cols-3 gap-2">
        <input className="input" placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input className="input" type="number" placeholder="Cant." value={newQty} onChange={(e) => setNewQty(e.target.value)} />
        <input className="input" type="number" placeholder="Precio" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
      </div>
      <button onClick={addItem} className="mb-3.5 w-full rounded-[10px] border border-dashed border-br2 py-2 text-[13px] font-semibold text-lime">
        + Agregar ítem
      </button>

      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Motivo de la corrección *</div>
      <textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ej: Se facturó precio equivocado, cliente devolvió un ítem..."
        className="input resize-none border-lime"
      />

      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={confirm} className="flex-[2] rounded-[10px] bg-orange py-2.5 text-[14px] font-extrabold text-black">
          ✓ Guardar corrección
        </button>
      </div>
    </BottomSheet>
  )
}
