import { usePinStore } from '../../store/usePinStore'

/** The one permission mechanism for the whole app (replaces legacy's two mixed systems:
 * `admin-only` CSS classes + ad-hoc checks in `navInventario`/`navReporte`). Call
 * `requireAdmin()` before any sensitive action; it resolves immediately if the session is
 * already unlocked, otherwise it prompts the PIN modal and resolves with the result. */
export function usePermission() {
  const isAdmin = usePinStore((s) => s.isAdminUnlocked)
  const ask = usePinStore((s) => s.ask)

  async function requireAdmin(title?: string, subtitle?: string): Promise<boolean> {
    if (usePinStore.getState().isAdminUnlocked) return true
    return ask(title ?? '🔐 Acceso protegido', subtitle ?? 'Ingresa tu PIN de seguridad')
  }

  return { isAdmin, requireAdmin }
}
