import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { getSettings } from '../../../db/repositories/settings'
import { balanceOf } from '../../../shared/lib/cash'
import type { CashMovement } from '../../../types/cash'
import { usePermission } from '../../pin/usePermission'

const NONE: CashMovement[] = []

/** Live view of the cash ledger: both balances (always the sum of movements, never stored) and
 * the open Caja Menor session. `ready` is false until the local mirror has answered, so screens
 * can avoid flashing "caja cerrada" for a moment on load. */
export function useCaja() {
  const loaded = useLiveQuery(() => db.cashMovements.toArray())
  const open = useLiveQuery(() => db.cashSessions.where('status').equals('abierta').toArray())
  const sessionCount = useLiveQuery(() => db.cashSessions.count())
  const movements = loaded ?? NONE
  const menor = useMemo(() => balanceOf(movements, 'menor'), [movements])
  const mayor = useMemo(() => balanceOf(movements, 'mayor'), [movements])
  return {
    ready: loaded !== undefined && open !== undefined && sessionCount !== undefined,
    movements,
    menor,
    mayor,
    session: open?.[open.length - 1],
    /** No caja has ever been opened: the next opening is the starting point of the books. */
    firstOpening: sessionCount === 0,
  }
}

/** Who to attribute a cash operation to: the unlocked admin, else the last cashier, else the owner. */
export function useActorName(): string {
  const { currentUserName } = usePermission()
  const settings = useLiveQuery(() => getSettings())
  return currentUserName ?? settings?.lastCajero ?? 'Propietario'
}
