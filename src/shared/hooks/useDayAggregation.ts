import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import type { Purchase } from '../../types/purchase'
import type { Extra } from '../../types/extra'
import { computeDayAggregate, type ComputeDayAggregateOptions, type DayAggregate } from '../lib/aggregation'

/** Reactive wrapper around `computeDayAggregate` — used by Reporte, Reporte X and the Cierre Z
 * flow so all three always agree on the same numbers (per the plan). */
export function useDayAggregation(dayKey: string, options: ComputeDayAggregateOptions = {}): DayAggregate {
  const sales = useLiveQuery(() => db.sales.where('dayKey').equals(dayKey).toArray(), [dayKey], [] as Sale[])
  const purchases = useLiveQuery(() => db.purchases.where('dayKey').equals(dayKey).toArray(), [dayKey], [] as Purchase[])
  const extras = useLiveQuery(() => db.extras.where('dayKey').equals(dayKey).toArray(), [dayKey], [] as Extra[])
  const onlyOpen = options.onlyOpen ?? false

  return useMemo(() => computeDayAggregate(dayKey, sales, purchases, extras, { onlyOpen }), [dayKey, sales, purchases, extras, onlyOpen])
}
