import { useState } from 'react'
import { Pencil, Phone, Plus } from 'lucide-react'
import { useSecureTable } from '../../../db/secure'
import type { Supplier } from '../../../types/supplier'
import { termsLabel } from '../lib/terms'
import { SupplierFormSheet } from './SupplierFormSheet'

export function SupplierList() {
  const suppliers = useSecureTable('suppliers')
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const sorted = [...suppliers].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'))

  function openForm(s: Supplier | null) {
    setEditing(s)
    setFormOpen(true)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13px] text-txt2">{suppliers.length} proveedor{suppliers.length !== 1 ? 'es' : ''}</div>
        <button onClick={() => openForm(null)} className="flex items-center gap-1.5 rounded-[10px] bg-lime px-3.5 py-2 text-[13px] font-bold text-on-solid">
          <Plus size={15} /> Nuevo proveedor
        </button>
      </div>

      {!sorted.length ? (
        <div className="rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">Aún no tienes proveedores. Crea el primero para poder hacerle pedidos.</div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((s) => (
            <div key={s.id} className={`rounded-xl border border-br bg-s1 p-3.5 shadow-xs ${s.active ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-bold">{s.name}</div>
                  {s.nit && <div className="font-mono text-[11px] text-muted">{s.nit}</div>}
                </div>
                <button onClick={() => openForm(s)} title="Editar" aria-label="Editar proveedor" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-br2 text-txt2 hover:border-lime/40 hover:text-lime">
                  <Pencil size={14} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.paymentTerms.kind === 'credito' ? 'border-blue/30 bg-blue/10 text-blue' : 'border-green/30 bg-green/10 text-green'}`}>{termsLabel(s.paymentTerms)}</span>
                {!s.active && <span className="rounded-full border border-br2 bg-s2 px-2 py-0.5 text-[11px] text-muted">Inactivo</span>}
              </div>
              {(s.contact || s.phone) && (
                <div className="mt-2 flex items-center gap-1.5 text-[12px] text-txt2">
                  <Phone size={12} className="flex-shrink-0 text-muted" />
                  <span className="truncate">{[s.contact, s.phone].filter(Boolean).join(' · ')}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <SupplierFormSheet open={formOpen} supplier={editing} onClose={() => setFormOpen(false)} />
    </div>
  )
}
