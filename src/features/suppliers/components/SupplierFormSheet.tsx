import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { createSupplier, deleteSupplier, updateSupplier } from '../../../db/repositories/suppliers'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import type { Supplier } from '../../../types/supplier'

interface SupplierFormSheetProps {
  open: boolean
  /** null = creating a new supplier. */
  supplier: Supplier | null
  onClose: () => void
}

export function SupplierFormSheet({ open, supplier, onClose }: SupplierFormSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[520px]">
      <SupplierForm supplier={supplier} onClose={onClose} />
    </BottomSheet>
  )
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const confirm = useConfirm()
  const [name, setName] = useState(supplier?.name ?? '')
  const [nit, setNit] = useState(supplier?.nit ?? '')
  const [contact, setContact] = useState(supplier?.contact ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [address, setAddress] = useState(supplier?.address ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')
  const [kind, setKind] = useState<'contado' | 'credito'>(supplier?.paymentTerms.kind ?? 'contado')
  const [days, setDays] = useState(supplier?.paymentTerms.kind === 'credito' ? String(supplier.paymentTerms.days) : '30')
  const [active, setActive] = useState(supplier?.active ?? true)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) {
      toast('Escribe el nombre del proveedor', 'orange')
      return
    }
    const daysNum = parseInt(days, 10)
    if (kind === 'credito' && (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365)) {
      toast('Los días de crédito deben estar entre 1 y 365', 'orange')
      return
    }
    const input = {
      name: name.trim(),
      nit: nit.trim(),
      contact: contact.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      notes: notes.trim(),
      paymentTerms: kind === 'contado' ? ({ kind: 'contado' } as const) : ({ kind: 'credito', days: daysNum } as const),
      active,
    }
    setBusy(true)
    try {
      if (supplier) await updateSupplier(supplier.id, input)
      else await createSupplier(input)
      toast(supplier ? 'Proveedor actualizado' : 'Proveedor creado', 'lime')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!supplier) return
    const ok = await confirm({ message: `¿Eliminar a ${supplier.name}?`, danger: true, confirmLabel: 'Eliminar' })
    if (!ok) return
    try {
      await deleteSupplier(supplier.id)
      toast('Proveedor eliminado', 'muted')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }

  const seg = (is: boolean) => `flex-1 rounded-[10px] border py-2 text-[13px] font-semibold transition-colors ${is ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s2'}`

  return (
    <>
      <div className="mb-3.5 font-display text-[18px] font-bold">{supplier ? `Editar proveedor` : 'Nuevo proveedor'}</div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Nombre *" span2>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre o razón social" autoFocus />
        </Field>
        <Field label="NIT / documento">
          <input className="input" value={nit} onChange={(e) => setNit(e.target.value)} />
        </Field>
        <Field label="Persona de contacto">
          <input className="input" value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Correo">
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
        </Field>
        <Field label="Dirección" span2>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="col-span-2 rounded-xl border border-br2 bg-s2 p-3">
          <div className="mb-2 field-label">Condición de pago</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setKind('contado')} className={seg(kind === 'contado')}>
              De contado
            </button>
            <button type="button" onClick={() => setKind('credito')} className={seg(kind === 'credito')}>
              A crédito
            </button>
          </div>
          {kind === 'credito' && (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="text-[13px] text-txt2">Plazo:</span>
              <input className="input w-24 text-center font-mono" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
              <span className="text-[13px] text-txt2">días</span>
            </div>
          )}
        </div>

        <Field label="Notas" span2>
          <textarea rows={2} className="input resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Días de visita, descuentos, observaciones..." />
        </Field>

        {supplier && (
          <label className="col-span-2 flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-lime" />
            Proveedor activo (se le pueden hacer pedidos)
          </label>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {supplier && (
          <button onClick={remove} className="rounded-[10px] border border-red/30 px-3 py-2.5 text-[13px] font-semibold text-red hover:bg-red/10">
            Eliminar
          </button>
        )}
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy} onClick={save} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-bg disabled:opacity-60">
          {supplier ? 'Guardar cambios' : 'Crear proveedor'}
        </button>
      </div>
    </>
  )
}

function Field({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${span2 ? 'col-span-2' : ''}`}>
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}
