import { useEffect, useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { addCustomer, updateCustomer } from '../../../db/repositories/customers'
import type { Customer } from '../../../types/customer'
import { toast } from '../../../store/useToastStore'

interface ClientFormSheetProps {
  open: boolean
  customer: Customer | null
  onClose: () => void
  onSaved: () => void
}

const EMPTY = { name: '', cedula: '', phone: '', email: '', birthday: '', notes: '' }

/** legacy `openClientForm()`/`saveClient()` (index.html L4393-4436). */
export function ClientFormSheet({ open, customer, onClose, onSaved }: ClientFormSheetProps) {
  const [f, setF] = useState(EMPTY)

  useEffect(() => {
    if (customer) {
      setF({
        name: customer.name,
        cedula: customer.cedula || '',
        phone: customer.phone || '',
        email: customer.email || '',
        birthday: customer.birthday || '',
        notes: customer.notes || '',
      })
    } else {
      setF(EMPTY)
    }
  }, [customer, open])

  function set<K extends keyof typeof EMPTY>(k: K, v: string) {
    setF((s) => ({ ...s, [k]: v }))
  }

  async function save() {
    if (!f.name.trim()) {
      toast('⚠ Escribe el nombre', 'orange')
      return
    }
    try {
      if (customer) {
        await updateCustomer(customer.id, f)
        toast('✓ Cliente actualizado', 'lime')
      } else {
        await addCustomer(f)
        toast('✓ Cliente agregado', 'lime')
      }
      onSaved()
    } catch (err) {
      toast('⚠ ' + (err instanceof Error ? err.message : String(err)), 'orange')
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <p className="mb-3.5 font-display text-[18px] font-bold">{customer ? 'Editar Cliente' : 'Nuevo Cliente'}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2 flex flex-col gap-1">
          <label className="field-label">Nombre completo *</label>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Nombre del cliente" autoFocus />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label">🪪 Cédula / ID</label>
          <input className="input" value={f.cedula} onChange={(e) => set('cedula', e.target.value)} placeholder="Número de cédula" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label">Teléfono</label>
          <input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="000-000-0000" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label">Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="correo@email.com" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="field-label">Cumpleaños</label>
          <input className="input" type="date" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} />
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label className="field-label">Dirección / Notas</label>
          <input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Dirección o notas" />
        </div>
      </div>
      <div className="mt-3.5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={save} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-black">
          Guardar Cliente
        </button>
      </div>
    </BottomSheet>
  )
}
