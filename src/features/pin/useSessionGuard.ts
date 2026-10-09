import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import { needsOfRole } from '../../shared/lib/permissions'
import { setSecurePerms } from '../../sync'
import { OWNER_ID, useSessionStore } from '../../store/useSessionStore'
import { lastActivity, markActive, signOut } from '../auth/session'
import { refreshCounterSession, startCounterSession, type SessionEnded } from './counterSession'
import { useAccessConfig } from './usePermission'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
/** How often the app renews its session's binding on the server and asks who it is now. */
const REFRESH_MS = 60_000

export const idleLabel = (m: number) => (m < 60 ? `${m} minutos` : m === 60 ? '1 hora' : `${m / 60} horas`)

/** The server said this session can't go on (it lost access, or must sign in again): sign out, and
 * the login says why. */
function endIf(result: SessionEnded | null | undefined): void {
  if (result) void signOut({ notice: result.ended }).catch(() => {})
}

/** Keeps the session honest, mounted once from AppShell:
 * - as the app starts the server binds this session to its account's person (what RLS reads), and
 *   renews it every minute; an account that lost access (deactivated, deleted) or has to sign in
 *   again is signed out, and the login says why;
 * - an admin renames the person or changes their role → applied at once;
 * - with "cerrar sesión por inactividad" on, nobody touching the screen for that long signs out —
 *   also when the app is reopened after that long;
 * - the secret data downloaded to this device always matches what whoever is working may see. */
export function useSessionGuard(): void {
  const operator = useSessionStore((s) => s.operator)
  const serverReady = useSessionStore((s) => s.serverReady)
  const { roles, access } = useAccessConfig()
  const usuarios = useLiveQuery(() => db.usuarios.toArray())

  useEffect(() => {
    let alive = true
    void startCounterSession().then((r) => alive && endIf(r))
    const timer = setInterval(() => void refreshCounterSession().then(endIf), REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // What this device may download: whoever is signed in — and nothing until the server agrees.
  const needs = useMemo(() => needsOfRole(roles, operator?.roleId).join(','), [roles, operator?.roleId])
  useEffect(() => {
    setSecurePerms(serverReady && needs ? needs.split(',') : [])
  }, [serverReady, needs])

  // An admin's edit of this person applies at once; deactivating them is confirmed with the server
  // right away (the local list alone may simply not have arrived yet).
  useEffect(() => {
    if (!operator || operator.id === OWNER_ID || !usuarios) return
    const u = usuarios.find((x) => x.id === operator.id)
    if (!u) return
    if (!u.active) void refreshCounterSession().then(endIf)
    else if (u.name !== operator.name || u.role !== operator.roleId) useSessionStore.getState().updateOperator({ name: u.name, roleId: u.role })
  }, [operator, usuarios])

  // Inactivity. The last use is kept on the device (also with the option off), so turning it on
  // doesn't count from some old time, and an app reopened after too long asks to sign in.
  const signedIn = !!operator
  const minutes = access.idleSignOutMinutes
  useEffect(() => {
    if (!signedIn) return
    let last = lastActivity() || Date.now()
    let saved = 0
    let retryAt = 0
    const touch = () => {
      last = Date.now()
      if (last - saved > 15_000) {
        saved = last
        markActive(last)
      }
    }
    const check = () => {
      // The latest use on any tab of this browser counts (they share the sign-in).
      const idleSince = Math.max(last, lastActivity())
      if (minutes <= 0 || Date.now() - idleSince < minutes * 60_000 || Date.now() < retryAt) return
      retryAt = Date.now() + 60_000 // offline, signing out fails: try again in a minute
      void signOut({ notice: `La sesión se cerró sola tras ${idleLabel(minutes)} sin uso` }).catch(() => {})
    }
    check()
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, touch, { capture: true, passive: true })
    const timer = setInterval(check, 5_000)
    return () => {
      clearInterval(timer)
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, touch, { capture: true })
    }
  }, [signedIn, minutes])
}
