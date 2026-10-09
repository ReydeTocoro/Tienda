import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { onPermissionNeeded } from '../../api/client'
import { usePinStore } from '../../store/usePinStore'
import { useSessionStore, type Operator } from '../../store/useSessionStore'
import { toast } from '../../store/useToastStore'
import { getSettings } from '../../db/repositories/settings'
import { ADMIN_ROLE_ID, permissionLabel, resolveRoles, roleCan, sanitizeAccess, type AccessSettings, type Need, type Role } from '../../shared/lib/permissions'
import type { Settings } from '../../types/settings'
import { counterApprove } from './counterSession'

export type { Need }

export function allows(roles: Role[], roleId: string | null | undefined, need: Need): boolean {
  if (!roleId) return false
  return need === 'admin' ? roleId === ADMIN_ROLE_ID : roleCan(roles, roleId, need)
}

export interface AccessConfig {
  roles: Role[]
  access: AccessSettings
}

export function accessConfigOf(settings: Settings | undefined): AccessConfig {
  return { roles: resolveRoles(settings?.roles), access: sanitizeAccess(settings?.access) }
}

/** Roles and access settings, live. */
export function useAccessConfig(): AccessConfig & { ready: boolean } {
  const settings = useLiveQuery(() => getSettings())
  return useMemo(() => ({ ...accessConfigOf(settings), ready: settings !== undefined }), [settings])
}

/** Asks for the PIN of someone allowed to let one step through (the server records the approval for
 * this device; the request that needed it then goes through). */
async function approveStep(need: Need, title: string, subtitle: string): Promise<Operator | null> {
  const result = await usePinStore.getState().ask(title, subtitle, (pin) => counterApprove(pin, need))
  return result.ok && result.operator ? result.operator : null
}

// A request the server refused for lack of a permission (a form opened under an approval that has
// since expired, say) asks for that PIN and goes again by itself.
onPermissionNeeded(
  async (need) => !!(await approveStep(need, permissionLabel(need), 'Esto necesita la autorización de alguien con permiso. Ingresa su PIN.')),
)

/** The one permission mechanism for the whole app. `can()` answers for whoever is working — the
 * person whose account is signed in on this device — to decide what to show; the server decides
 * what actually happens, with the same rules. For a step they can't take, `requirePermission()` /
 * `authorize()` ask for the PIN of someone allowed and let that one step through — a supervisor
 * approving a cashier's discount — without changing who is signed in. What only an Administrador
 * does needs an Administrador's own account ("Cambiar de usuario"). PINs are checked by the server
 * (src/features/pin/counterSession.ts). */
export function usePermission() {
  const operator = useSessionStore((s) => s.operator)
  const lastAuthorizer = useSessionStore((s) => s.lastAuthorizer)
  const { roles, access, ready } = useAccessConfig()
  const roleId = operator?.roleId ?? null

  const can = (need: Need) => allows(roles, roleId, need)

  /** Resolves with whoever allowed the step — the current person when they already can — or null if cancelled. */
  async function authorize(need: Need, title: string, subtitle: string): Promise<Operator | null> {
    const cfg = accessConfigOf(await getSettings())
    const current = useSessionStore.getState().operator
    if (!current) {
      toast('Conectando con el servidor… inténtalo en un momento', 'muted')
      return null
    }
    if (allows(cfg.roles, current.roleId, need)) return current
    if (need === 'admin') {
      toast('Esto solo lo hace un administrador, con su propia cuenta', 'orange')
      return null
    }
    return approveStep(need, title, subtitle)
  }

  async function requirePermission(need: Need, title: string, subtitle: string): Promise<boolean> {
    return (await authorize(need, title, subtitle)) !== null
  }

  return {
    /** False until the settings have been read and who is working is known: until then `can()`
     * knows nothing. */
    ready: ready && !!operator,
    operator,
    roleId,
    role: roles.find((r) => r.id === roleId),
    roles,
    access,
    can,
    isAdmin: roleId === ADMIN_ROLE_ID,
    authorize,
    requirePermission,
    /** For attribution: who is signed in, else who authorized the latest step. */
    currentUserName: operator?.name ?? lastAuthorizer ?? null,
  }
}
