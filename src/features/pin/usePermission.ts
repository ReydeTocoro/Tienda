import { usePinStore, type PinVerifyResult } from '../../store/usePinStore'
import { getSettings } from '../../db/repositories/settings'
import { listUsuarios } from '../../db/repositories/usuarios'
import { sha256 } from '../../shared/lib/pin'

/** Matches the entered PIN against the master `settings.pinHash` (the store's one built-in
 * "owner" credential, always available) or any active admin-role usuario — so several people
 * can each carry their own admin PIN instead of everyone sharing one secret. */
async function verifyAdmin(entered: string): Promise<PinVerifyResult> {
  const hash = await sha256(entered)
  const settings = await getSettings()
  if (hash === settings.pinHash) return { ok: true, identity: 'Propietario' }
  const usuarios = await listUsuarios()
  const match = usuarios.find((u) => u.active && u.role === 'admin' && u.pinHash === hash)
  return match ? { ok: true, identity: match.name } : { ok: false }
}

/** The one permission mechanism for the whole app (replaces legacy's two mixed systems:
 * `admin-only` CSS classes + ad-hoc checks in `navInventario`/`navReporte`). Call
 * `requireAdmin()` before any sensitive action; it resolves immediately if the session is
 * already unlocked, otherwise it prompts the PIN modal and resolves with the result. */
export function usePermission() {
  const isAdmin = usePinStore((s) => s.isAdminUnlocked)
  const currentUserName = usePinStore((s) => s.lastIdentity)
  const ask = usePinStore((s) => s.ask)

  async function requireAdmin(title?: string, subtitle?: string): Promise<boolean> {
    if (usePinStore.getState().isAdminUnlocked) return true
    const result = await ask(title ?? 'Acceso protegido', subtitle ?? 'Ingresa tu PIN de seguridad', verifyAdmin)
    if (result.ok) usePinStore.getState().markAdminUnlocked()
    return result.ok
  }

  return { isAdmin, currentUserName, requireAdmin }
}
