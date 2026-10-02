import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import type { CashMovement } from '../../types/cash'
import { computeDayAggregate, type ComputeDayAggregateOptions, type DayAggregate } from '../lib/aggregation'

/** Reactive wrapper around `computeDayAggregate` — used by Reporte, Reporte X and the Cierre Z
 * flow so all three always agree on the same numbers (per the plan). */
export function useDayAggregation(dayKey: string, options: ComputeDayAggregateOptions = {}): DayAggregate {
  const sales = useLiveQuery(() => db.sales.where('dayKey').equals(dayKey).toArray(), [dayKey], [] as Sale[])
  const movements = useLiveQuery(() => db.cashMovements.where('dayKey').equals(dayKey).toArray(), [dayKey], [] as CashMovement[])
  const onlyOpen = options.onlyOpen ?? false

  return useMemo(() => computeDayAggregate(dayKey, sales, movements, { onlyOpen }), [dayKey, sales, movements, onlyOpen])
}
