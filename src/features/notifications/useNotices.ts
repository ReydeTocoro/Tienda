import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import { useSecureLoaded, useSecureTable } from '../../db/secure'
import { getFiadoDebt } from '../../db/repositories/sales'
import { useOutboxCounts } from '../../offline/outbox'
import { todayKey } from '../../shared/lib/currency'
import { getSettings } from '../../db/repositories/settings'
import { useSessionStore } from '../../store/useSessionStore'
import { groupFiados, groupTotals } from '../fiados/lib/fiadoGrouping'
import { usePermission } from '../pin/usePermission'
import { isLowStock } from '../pos/lib/saleProducts'
import { buildNotices, type Notice } from './lib/notices'

/** The notices of whoever is working, live. Each module gives its own only to whoever may open it (the same need as
 * its nav item); the payables and orders only reach this device for them anyway. The system's monthly payment is the
 * Administrador's (the store's owner) alone. `ready` = what they may see has been
 * read (the payables downloaded too), so the daily sheet doesn't open on half the picture. */
export function useNotices(): { notices: Notice[]; ready: boolean } {
  const { can, isAdmin, ready: permsReady } = usePermission()
  const servicePaid = useLiveQuery(() => getSettings().then((s) => s.servicePaid ?? ''))
  const serverReady = useSessionStore((s) => s.serverReady)
  const seePagos = can('proveedores.gestionar')
  const seeStock = can('stock.ver')
  const seeFiados = can('fiados.ver')
  const seeCaja = can('caja.cerrar')

  const payables = useSecureTable('payables')
  const payablesLoaded = useSecureLoaded('payables')
  const orders = useSecureTable('purchaseOrders')
  // Only what is out or low, not the whole inventory.
  const products = useLiveQuery(() => (seeStock ? db.products.filter((p) => p.stock <= 0 || isLowStock(p)).toArray() : []), [seeStock])
  const fiadoSales = useLiveQuery(() => (seeFiados ? db.sales.where('payMethod').equals('fiado').toArray() : []), [seeFiados])
  const caja = useLiveQuery(() => db.cajaState.get('menor').then((s) => s ?? null))
  const outbox = useOutboxCounts()

  // The day rolls over by itself at midnight (a till left on).
  const [today, setToday] = useState(todayKey)
  useEffect(() => {
    const t = setInterval(() => setToday(todayKey()), 60_000)
    return () => clearInterval(t)
  }, [])

  const debtors = useMemo(
    () =>
      fiadoSales &&
      groupFiados(fiadoSales).map((g) => ({
        name: g.name,
        debt: groupTotals(g).totalDebt,
        since: g.sales.filter((s) => getFiadoDebt(s) > 0).reduce((min, s) => (s.dayKey < min ? s.dayKey : min), today),
      })),
    [fiadoSales, today],
  )

  const notices = useMemo(
    () =>
      buildNotices({
        today,
        payables: seePagos ? payables : undefined,
        orders: seePagos ? orders : undefined,
        products: seeStock ? products : undefined,
        debtors: seeFiados ? debtors : undefined,
        caja: seeCaja ? caja : undefined,
        outbox,
        servicePayment: isAdmin ? { paid: servicePaid || undefined } : undefined,
      }),
    [today, seePagos, payables, orders, seeStock, products, seeFiados, debtors, seeCaja, caja, outbox, isAdmin, servicePaid],
  )

  const ready = permsReady && serverReady && products !== undefined && fiadoSales !== undefined && caja !== undefined && servicePaid !== undefined && (!seePagos || payablesLoaded)
  return { notices, ready }
}
