import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { formatMoney, formatQty, todayKey } from '../../../shared/lib/currency'

interface VentaKpiBarProps {
  onClickLowStock: () => void
}

/** Mini live stats row — legacy `updateVentaKPIs()` (index.html L5199-5224). */
export function VentaKpiBar({ onClickLowStock }: VentaKpiBarProps) {
  const sales = useLiveQuery(() => db.sales.where('dayKey').equals(todayKey()).toArray(), [], [])
  const lowStockCount = useLiveQuery(
    () => db.products.filter((p) => p.stock > 0 && p.min > 0 && p.stock <= p.min).count(),
    [],
    0,
  )

  const totalVentas = sales.reduce((a, s) => a + s.total, 0)
  const numTx = sales.length
  const avgTicket = numTx ? totalVentas / numTx : 0
  const totalGanancia = sales.reduce((a, s) => a + (s.ganancia || 0), 0)
  const margen = totalVentas > 0 ? (totalGanancia / totalVentas) * 100 : 0

  return (
    // A tally strip, not a grid of stat cards: one continuous row divided by rules — like a
    // receipt summary line — instead of five identical bordered/rounded tiles.
    <div className="flex flex-shrink-0 divide-x divide-br overflow-x-auto border-b border-br bg-s1 [scrollbar-width:none]">
      <Kpi label="Ventas hoy" value={formatMoney(totalVentas)} />
      <Kpi label="Transacc." value={formatQty(numTx)} />
      <Kpi label="Margen" value={margen.toFixed(0) + '%'} />
      <Kpi label="Ticket prom." value={formatMoney(avgTicket)} />
      <Kpi label="Stock bajo" value={formatQty(lowStockCount)} warn={lowStockCount > 0} onClick={onClickLowStock} />
    </div>
  )
}

function Kpi({ label, value, warn, onClick }: { label: string; value: string; warn?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`min-w-[84px] flex-shrink-0 px-3 py-2 text-center ${onClick ? '' : 'cursor-default'}`}
    >
      <div className={`font-mono text-[13px] font-bold ${warn ? 'text-orange' : 'text-lime'}`}>{value}</div>
      <div className="mt-0.5 field-label">{label}</div>
    </button>
  )
}
