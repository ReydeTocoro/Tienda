import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { useSecureLoaded, useSecureTable } from '../../../db/secure'
import { getSettings } from '../../../db/repositories/settings'
import { balanceOf } from '../../../shared/lib/cash'
import { usePermission } from '../../pin/usePermission'

/** The open Caja Menor workday, as everyone may see it: since when and by whom — no amounts. */
export interface OpenCaja {
  id?: number
  dayKey: string
  openedAt: string
  openedBy: string
}

/** Live view of the cajas. Whether the Caja Menor is open (and whether a caja was ever opened) comes
 * from "cajaState", which everyone gets. The ledger itself — both balances (always the sum of
 * movements, never stored) and the movements — only reaches this device for whoever may see the
 * expected cash (`balancesKnown`); for anyone else the balances read 0 and must not be shown. */
export function useCaja() {
  const state = useLiveQuery(() => db.cajaState.get('menor').then((s) => s ?? null))
  const movements = useSecureTable('cashMovements')
  const balancesKnown = useSecureLoaded('cashMovements')
  const sessions = useSecureTable('cashSessions')
  const menor = useMemo(() => balanceOf(movements, 'menor'), [movements])
  const mayor = useMemo(() => balanceOf(movements, 'mayor'), [movements])
  const session: OpenCaja | undefined = useMemo(
    () => (state?.open ? { id: state.sessionId, dayKey: state.dayKey ?? '', openedAt: state.openedAt ?? '', openedBy: state.openedBy ?? '' } : undefined),
    [state],
  )
  // With how much the open workday was opened (the cash counted then). It sits in "cashSessions", which — like the ledger —
  // only reaches whoever may see the expected cash: `undefined` for anyone else (a blind count never learns it) and while it arrives.
  const openingCash = useMemo(() => (session?.id === undefined ? undefined : sessions.find((s) => s.id === session.id)?.openingCash), [sessions, session])
  return {
    /** False until the local copy has answered, so screens don't flash "caja cerrada" on load. */
    ready: state !== undefined,
    movements,
    menor,
    mayor,
    balancesKnown,
    session,
    /** What the open workday was opened with — for whoever may see the expected cash only (else `undefined`). */
    openingCash,
    /** No caja has ever been opened: the next opening is the starting point of the books. */
    firstOpening: !state?.started,
  }
}

/** Who to attribute a cash operation to on screen: whoever is signed in (else, while the app
 * connects, the last cashier). The server signs it with whoever is signed in anyway. */
export function useActorName(): string {
  const { currentUserName } = usePermission()
  const settings = useLiveQuery(() => getSettings())
  return currentUserName ?? settings?.lastCajero ?? 'Propietario'
}
