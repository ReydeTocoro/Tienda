import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import { useSecureTable } from '../../db/secure'
import type { Sale } from '../../types/sale'
import { computeDayAggregate, type ComputeDayAggregateOptions, type DayAggregate } from '../lib/aggregation'
import { useProfits, withProfits } from './useSecretFigures'

/** Reactive wrapper around `computeDayAggregate` — used by Reporte, Reporte X and the Cierre Z
 * flow so all three always agree on the same numbers (per the plan). The sales are everyone's; their
 * profit and the day's cash movements only count for whoever may see them (they don't reach this
 * device otherwise), so `totalGanancia` and the cash figures are only meaningful with those
 * permissions. The Cierre Z itself is computed by the server. */
export function useDayAggregation(dayKey: string, options: ComputeDayAggregateOptions = {}): DayAggregate {
  const sales = useLiveQuery(() => db.sales.where('dayKey').equals(dayKey).toArray(), [dayKey], [] as Sale[])
  const movements = useSecureTable('cashMovements')
  const { sales: profits } = useProfits()
  const onlyOpen = options.onlyOpen ?? false

  return useMemo(
    () =>
      computeDayAggregate(
        dayKey,
        withProfits(sales, profits),
        movements.filter((m) => m.dayKey === dayKey),
        { onlyOpen },
      ),
    [dayKey, sales, profits, movements, onlyOpen],
  )
}
