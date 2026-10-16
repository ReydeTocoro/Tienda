import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import { useDayAggregation } from '../../shared/hooks/useDayAggregation'
import { formatMoney, todayKey } from '../../shared/lib/currency'
import { TransferByAccount } from '../../shared/components/TransferByAccount'
import { transferRows } from '../../shared/lib/transferAccounts'
import { CierresHistoryList } from './components/CierresHistoryList'
import { usePermission } from '../pin/usePermission'

const PAY_LABEL: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia' }

export function ReportePage() {
  const [dayKey, setDayKey] = useState(todayKey())
  const showProfit = usePermission().can('ganancias.ver')

  const agg = useDayAggregation(dayKey, { onlyOpen: false })

  // Global fiado portfolio (all-time), independent of the selected date.
  const fiadoSales = useLiveQuery(() => db.sales.where('payMethod').equals('fiado').filter((s) => !s.voided).toArray(), [], [] as Sale[])
  const fiadoStats = useMemo(() => {
    const debt = fiadoSales.reduce((a, s) => {
      const paid = (s.fiadoPagos || []).reduce((x, p) => x + p.amount, 0)
      return a + Math.max(0, s.total - paid)
    }, 0)
    const paid = fiadoSales.reduce((a, s) => {
      const p = (s.fiadoPagos || []).reduce((x, pg) => x + pg.amount, 0)
      return a + Math.min(p, s.total)
    }, 0)
    const debtors = new Set(
      fiadoSales
        .filter((s) => {
          const p = (s.fiadoPagos || []).reduce((x, pg) => x + pg.amount, 0)
          return s.total - p > 0
        })
        .map((s) => s.customerId || s.fiadoName || '?'),
    ).size
    return { debt, paid, debtors }
  }, [fiadoSales])

  const fiadosToday = agg.ventasDay.filter((s) => s.payMethod === 'fiado')

  return (
    <div className="p-3.5 md:mx-auto md:max-w-[1200px] md:p-5">
      <p className="mb-3.5 font-display text-[21px] font-bold md:mb-2.5 md:text-[22px]">Reporte de Caja</p>

      <div className="mb-3.5 md:max-w-xs">
        <label className="mb-1 block field-label">Filtrar por fecha</label>
        <div className="flex gap-2">
          <input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} className="input flex-1" />
          <button onClick={() => setDayKey(todayKey())} className="rounded-[10px] bg-lime px-4 py-2 text-[13px] font-bold text-on-solid transition-opacity hover:opacity-90">
            Hoy
          </button>
        </div>
      </div>

      <div className={`mb-3.5 grid grid-cols-2 gap-2.5 ${showProfit ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <Kpi label="Ventas del día" value={formatMoney(agg.totalVentas)} color="text-green" sub={`${agg.numTx} transacción${agg.numTx !== 1 ? 'es' : ''}`} />
        {showProfit && (
          <Kpi label="Ganancia bruta" value={formatMoney(agg.totalGanancia)} color="text-lime" sub={`Margen: ${agg.totalVentas ? ((agg.totalGanancia / agg.totalVentas) * 100).toFixed(1) : 0}%`} />
        )}
        <Kpi label="Ticket promedio" value={formatMoney(agg.avgTicket)} color="text-blue" sub={`Desc. dados: ${formatMoney(agg.totalDescuentos)}`} />
        <Kpi label="Egresos de caja" value={formatMoney(agg.totalExOut)} color="text-red" sub={`Otros ingresos: +${formatMoney(agg.totalExIn)}`} />
        <div className={`col-span-2 rounded-[14px] border border-br bg-s1 p-4 text-center shadow-xs ${showProfit ? 'md:col-span-4' : 'md:col-span-3'}`}>
          <div className="field-label">Flujo neto del día</div>
          <div className={`my-1.5 font-mono text-[26px] font-bold ${agg.netDay >= 0 ? 'text-lime' : 'text-red'}`}>{formatMoney(agg.netDay)}</div>
          <div className="text-[11px] text-txt2">
            {agg.netDay >= 0 ? 'Día positivo' : 'Día negativo'}
            {agg.fiadoTotalDay > 0 ? ` · En caja: ${formatMoney(agg.flujoCaja)}` : ''}
          </div>
        </div>
      </div>

      <div className="md:grid md:grid-cols-2 md:items-start md:gap-5">
        <div>
          <p className="mb-2 field-label">Desglose por pago</p>
          <div className="mb-3.5 rounded-[14px] border border-br bg-s1 p-3.5 shadow-xs">
            {(['efectivo', 'transferencia'] as const).map((m) => (
              <div key={m} className="flex justify-between border-b border-br py-2 last:border-b-0">
                <span className="text-[13px]">{PAY_LABEL[m]}</span>
                <span className="font-mono font-semibold">
                  {agg.ventasDay.filter((s) => s.payMethod === m).length} · {formatMoney(agg.payBreak[m])}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-br pt-2">
              <span className="text-[13px] font-bold text-green">Cobrado en caja</span>
              <span className="font-mono font-bold text-green">{formatMoney(agg.cobradoReal)}</span>
            </div>
            <div className="flex justify-between pt-2">
              <span className="text-[13px] text-red">Fiado (por cobrar)</span>
              <span className="font-mono font-semibold text-red">
                {fiadosToday.length} · {formatMoney(agg.fiadoTotalDay)}
              </span>
            </div>
          </div>
          {transferRows(agg.transferBreak).length > 0 && (
            <>
              <p className="mb-2 field-label">Transferencias por cuenta (ventas y abonos)</p>
              <div className="mb-3.5 space-y-1.5 rounded-[14px] border border-br bg-s1 p-3.5 text-[13px] shadow-xs">
                <TransferByAccount breakdown={agg.transferBreak} />
              </div>
            </>
          )}
        </div>

        <div>
          <p className="mb-2 mt-3.5 text-[13px] font-bold uppercase tracking-wide text-red md:mt-0">Fiados</p>
          <div className="mb-2.5 rounded-xl border border-red/20 bg-red/10 p-3.5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-red">Fiados generados hoy ({dayKey})</div>
            {!fiadosToday.length ? (
              <div className="text-[13px] text-muted">Sin ventas fiadas en esta fecha </div>
            ) : (
              fiadosToday.map((s) => {
                const paid = (s.fiadoPagos || []).reduce((a, p) => a + p.amount, 0)
                const deuda = Math.max(0, s.total - paid)
                return (
                  <div key={s.id} className="flex justify-between border-b border-red/10 py-2 last:border-b-0">
                    <div>
                      <div className="text-[13px] font-semibold">{s.fiadoName || s.customerName || 'Sin nombre'}</div>
                      <div className="mt-0.5 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted">
                        {s.items.map((i) => i.name).join(', ')}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-[14px] font-bold ${deuda <= 0 ? 'text-green' : 'text-red'}`}>{deuda <= 0 ? 'Pagado' : formatMoney(deuda)}</div>
                      <div className="text-[10px] text-muted">Total: {formatMoney(s.total)}</div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="mb-3.5 rounded-xl border border-br bg-s1 p-3.5 shadow-xs">
            <div className="mb-2.5 field-label">Cartera de fiados (todos los tiempos)</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="field-label">Por cobrar</div>
                <div className="font-mono text-[16px] font-bold text-red">{formatMoney(fiadoStats.debt)}</div>
              </div>
              <div>
                <div className="field-label">Cobrado</div>
                <div className="font-mono text-[16px] font-bold text-green">{formatMoney(fiadoStats.paid)}</div>
              </div>
              <div>
                <div className="field-label">Deudores</div>
                <div className="font-mono text-[16px] font-bold text-orange">{fiadoStats.debtors}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="mb-2 mt-3.5 field-label">Historial de cierres</p>
      <div className="md:max-w-xl">
        <CierresHistoryList />
      </div>
    </div>
  )
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="rounded-[14px] border border-br bg-s1 p-4 text-center shadow-xs">
      <div className="field-label">{label}</div>
      <div className={`my-1.5 font-mono text-[22px] font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-txt2">{sub}</div>
    </div>
  )
}
