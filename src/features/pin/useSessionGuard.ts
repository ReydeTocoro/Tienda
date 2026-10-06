import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import { needsOfRole } from '../../shared/lib/permissions'
import { setSecurePerms } from '../../sync'
import { OWNER_ID, useSessionStore } from '../../store/useSessionStore'
import { toast } from '../../store/useToastStore'
import { counterHeartbeat, counterSignOut, counterSignOutOnExit, resetCounterOnServer } from './counterSession'
import { effectiveRoleId, useAccessConfig } from './usePermission'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
/** How often the app tells the server the signed-in person is still here (it forgets them after 3
 * minutes without hearing from this device). */
const HEARTBEAT_MS = 45_000

/** Keeps the counter session honest, mounted once from AppShell:
 * - as the app starts, the server is told nobody is signed in here (a reload signs out);
 * - PIN mode with nobody signed in → `locked` (AppShell shows the lock screen);
 * - nobody touches the screen for `access.autoLockMinutes` → whoever signed in is signed out, so a
 *   supervisor who walked away doesn't leave their permissions on the counter;
 * - while someone is signed in, a heartbeat keeps the server's record alive — and if the server no
 *   longer has them (deactivated, expired), they're signed out here too; closing the page signs out;
 * - an admin deactivates or deletes the signed-in user → signed out; renames them or changes their
 *   role → applied at once;
 * - the secret data downloaded to this device always matches what whoever is working may see. */
export function useSessionGuard(): { locked: boolean } {
  const operator = useSessionStore((s) => s.operator)
  const serverReady = useSessionStore((s) => s.serverReady)
  const { roles, access, ready } = useAccessConfig()
  const usuarios = useLiveQuery(() => db.usuarios.toArray())
  const locked = ready && access.mode === 'pin' && !operator

  useEffect(() => {
    void resetCounterOnServer()
    window.addEventListener('pagehide', counterSignOutOnExit)
    return () => window.removeEventListener('pagehide', counterSignOutOnExit)
  }, [])

  useEffect(() => {
    useSessionStore.getState().setLocked(locked)
  }, [locked])

  // What this device may download: whoever is signed in, else the open counter — and nothing until
  // the server agrees on who that is.
  const roleId = ready ? effectiveRoleId(operator, access) : null
  const needs = useMemo(() => needsOfRole(roles, roleId).join(','), [roles, roleId])
  useEffect(() => {
    setSecurePerms(serverReady && needs ? needs.split(',') : [])
  }, [serverReady, needs])

  useEffect(() => {
    if (!operator || operator.id === OWNER_ID || !usuarios) return
    const u = usuarios.find((x) => x.id === operator.id)
    if (!u || !u.active) {
      void counterSignOut()
      toast(`${operator.name} ya no tiene un usuario activo`, 'orange')
      return
    }
    if (u.name !== operator.name || u.role !== operator.roleId) useSessionStore.getState().updateOperator({ name: u.name, roleId: u.role })
  }, [operator, usuarios])

  const signedIn = !!operator
  useEffect(() => {
    if (!signedIn) return
    const timer = setInterval(async () => {
      const current = useSessionStore.getState().operator
      if (!current) return
      const onServer = await counterHeartbeat()
      if (onServer === null && useSessionStore.getState().operator?.id === current.id) {
        useSessionStore.getState().signOut()
        toast(`${current.name}: la sesión se cerró`, 'muted')
      }
    }, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [signedIn])

  const minutes = access.autoLockMinutes
  useEffect(() => {
    if (!signedIn || minutes <= 0) return
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, touch, { capture: true, passive: true })
    const timer = setInterval(() => {
      if (Date.now() - last < minutes * 60_000) return
      const name = useSessionStore.getState().operator?.name
      void counterSignOut()
      toast(`${name ?? 'La sesión'}: se cerró por ${minutes} min sin uso`, 'muted')
    }, 5_000)
    return () => {
      clearInterval(timer)
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, touch, { capture: true })
    }
  }, [signedIn, minutes])

  return { locked }
}
