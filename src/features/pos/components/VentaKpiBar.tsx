import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { formatMoney, todayKey } from '../../../shared/lib/currency'

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
    <div className="flex flex-shrink-0 gap-1.5 overflow-x-auto px-3 pt-1.5 [scrollbar-width:none]">
      <Kpi label="Ventas hoy" value={formatMoney(totalVentas)} />
      <Kpi label="Transacc." value={String(numTx)} />
      <Kpi label="Margen" value={margen.toFixed(0) + '%'} />
      <Kpi label="Ticket prom." value={formatMoney(avgTicket)} />
      <Kpi label="Stock bajo" value={String(lowStockCount)} warn={lowStockCount > 0} onClick={onClickLowStock} />
    </div>
  )
}

function Kpi({ label, value, warn, onClick }: { label: string; value: string; warn?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`min-w-[80px] flex-shrink-0 rounded-[10px] border border-br bg-s1 px-2.5 py-1.5 text-center ${onClick ? '' : 'cursor-default'}`}
    >
      <div className={`font-mono text-[13px] font-bold ${warn ? 'text-orange' : 'text-lime'}`}>{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted">{label}</div>
    </button>
  )
}
