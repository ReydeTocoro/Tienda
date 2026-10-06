import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { onPermissionNeeded } from '../../api/client'
import { usePinStore } from '../../store/usePinStore'
import { useSessionStore, type Operator } from '../../store/useSessionStore'
import { getSettings } from '../../db/repositories/settings'
import { ADMIN_ROLE_ID, permissionLabel, resolveRoles, roleCan, sanitizeAccess, type AccessSettings, type Need, type Role } from '../../shared/lib/permissions'
import type { Settings } from '../../types/settings'
import { counterApprove, counterSignIn } from './counterSession'

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
  const roles = resolveRoles(settings?.roles)
  return { roles, access: sanitizeAccess(settings?.access, roles) }
}

/** The role in effect right now: whoever signed in, else the open counter's role; none while the
 * PIN-mode lock screen is up. */
export function effectiveRoleId(operator: Operator | null, access: AccessSettings): string | null {
  return operator?.roleId ?? (access.mode === 'abierto' ? access.counterRole : null)
}

/** The open counter, as an "operator" — what `authorize()` answers when nobody signed in but the
 * counter role itself already allows the step. */
export const COUNTER_ID = 'counter'
const counterOperator = (access: AccessSettings): Operator => ({ id: COUNTER_ID, name: 'Mostrador', roleId: access.counterRole })

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

/** The one permission mechanism for the whole app. `can()` answers for whoever is working right
 * now (signed in, or the open counter's role) — to decide what to show; the server decides what
 * actually happens, with the same rules. For a step they can't take:
 * - `requirePermission()` / `authorize()` ask for the PIN of someone allowed and let that one step
 *   through — a supervisor approving a cashier's discount — without changing who is signed in;
 * - `signInFor()` (module entry: Stock, Reporte… and seeing purchase prices) signs in whoever's PIN
 *   opened it, until they leave or the screen auto-locks.
 * PINs are checked by the server (src/features/pin/counterSession.ts). */
export function usePermission() {
  const operator = useSessionStore((s) => s.operator)
  const lastAuthorizer = useSessionStore((s) => s.lastAuthorizer)
  const { roles, access, ready } = useAccessConfig()
  const ask = usePinStore((s) => s.ask)
  const roleId = effectiveRoleId(operator, access)

  const can = (need: Need) => allows(roles, roleId, need)

  /** Resolves with whoever allowed the step — the current person when they already can — or null if cancelled. */
  async function authorize(need: Need, title: string, subtitle: string): Promise<Operator | null> {
    const cfg = accessConfigOf(await getSettings())
    const current = useSessionStore.getState().operator
    if (allows(cfg.roles, effectiveRoleId(current, cfg.access), need)) return current ?? counterOperator(cfg.access)
    // What only the Administrador does isn't authorized step by step: the Administrador signs in.
    if (need === 'admin') return (await signInFor(need, title, subtitle)) ? useSessionStore.getState().operator : null
    return approveStep(need, title, subtitle)
  }

  async function requirePermission(need: Need, title: string, subtitle: string): Promise<boolean> {
    return (await authorize(need, title, subtitle)) !== null
  }

  async function signInFor(need: Need, title: string, subtitle: string): Promise<boolean> {
    const cfg = accessConfigOf(await getSettings())
    if (allows(cfg.roles, effectiveRoleId(useSessionStore.getState().operator, cfg.access), need)) return true
    const result = await ask(title, subtitle, (pin) => counterSignIn(pin, need))
    return result.ok
  }

  /** "Ingresar" / "Cambiar de usuario": any active person's PIN signs them in. */
  async function signInAny(title: string, subtitle: string): Promise<boolean> {
    const result = await ask(title, subtitle, (pin) => counterSignIn(pin))
    return result.ok
  }

  return {
    /** False until the settings have been read: until then `can()` only knows the default roles. */
    ready,
    operator,
    roleId,
    role: roles.find((r) => r.id === roleId),
    roles,
    access,
    can,
    isAdmin: roleId === ADMIN_ROLE_ID,
    authorize,
    requirePermission,
    signInFor,
    signInAny,
    /** For attribution: who is signed in, else who authorized the latest step. */
    currentUserName: operator?.name ?? lastAuthorizer ?? null,
  }
}
