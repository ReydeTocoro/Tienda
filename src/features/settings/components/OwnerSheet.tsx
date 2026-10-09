import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { updateSettings } from '../../../db/repositories/settings'
import { Avatar } from '../../../shared/components/Avatar'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { OWNER_ID, useSessionStore } from '../../../store/useSessionStore'
import { toast } from '../../../store/useToastStore'
import { refreshCounterSession } from '../../pin/counterSession'
import { TONE_AVATAR } from '../lib/roleDisplay'
import { PhotoField } from './PhotoField'
import { primaryButton, secondaryButton } from './ui'

export interface OwnerProfileView {
  name: string
  photo?: string
  /** Their sign-in accounts (the emails in `staff`). */
  emails: string[]
}

export function OwnerSheet({ open, owner, onClose }: { open: boolean; owner: OwnerProfileView; onClose: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[520px]">
      <OwnerForm owner={owner} onClose={onClose} />
    </BottomSheet>
  )
}

/** The owner's name and picture. The name is what sales, cashier closings and authorizations carry
 * for them; their email and password are their Supabase account's (the password changes from their
 * own menu, "Cambiar mi contraseña"). */
function OwnerForm({ owner, onClose }: { owner: OwnerProfileView; onClose: () => void }) {
  const [name, setName] = useState(owner.name)
  const [photo, setPhoto] = useState(owner.photo)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const clean = name.trim()
    if (!clean) return setError('Escribe el nombre')
    setBusy(true)
    try {
      await updateSettings({ owner: { name: clean, ...(photo ? { photo } : {}) } })
      // Whoever is signed in as the owner sees their new name right away, not at the next minute.
      if (useSessionStore.getState().operator?.id === OWNER_ID) void refreshCounterSession()
      toast('Datos del propietario guardados', 'green')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={name || '?'} photo={photo} className={`h-11 w-11 text-[14px] font-bold ${TONE_AVATAR.lime}`} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[18px] font-bold leading-tight">Datos del propietario</div>
          <div className="truncate text-[12px] text-muted">Administrador · acceso total</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>

      <label htmlFor="owner-name" className="mb-1 block field-label">
        Nombre
      </label>
      <input id="owner-name" className="input mb-4" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Nombre del propietario" autoFocus />

      <PhotoField photo={photo} onChange={setPhoto} hint="Opcional. Se ve junto a su nombre." />

      <div className="mb-4 rounded-xl border border-br p-3">
        <div className="text-[13px] font-semibold">Correo para entrar</div>
        <div className="mt-0.5 break-all text-[13px] text-txt2">{owner.emails.length ? owner.emails.join(', ') : 'La cuenta de la tienda'}</div>
        <div className="mt-1 text-[12px] text-muted">Su contraseña la cambia desde el menú de su nombre (Cambiar mi contraseña). El correo lo administra quien instaló el sistema.</div>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${secondaryButton} ml-auto`} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" disabled={busy} className={`${primaryButton} min-w-[140px]`}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}
