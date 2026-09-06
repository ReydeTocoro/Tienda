import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import { useDayAggregation } from '../../shared/hooks/useDayAggregation'
import { formatMoney, todayKey, formatDateTime } from '../../shared/lib/currency'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import { formatSaleId } from '../../shared/lib/id'
import { ReporteXModal } from './components/ReporteXModal'
import { CierreZModal } from './components/CierreZModal'
import { ExtraFormSheet } from './components/ExtraFormSheet'
import { CierresHistoryList } from './components/CierresHistoryList'
import { CorrectionsHistoryList } from './components/CorrectionsHistoryList'

const PAY_LABEL: Record<string, string> = { efectivo: '💵 Efectivo', transferencia: '📲 Transferencia' }

export function ReportePage() {
  const [dayKey, setDayKey] = useState(todayKey())
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [reporteXOpen, setReporteXOpen] = useState(false)
  const [cierreZOpen, setCierreZOpen] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)

  const agg = useDayAggregation(dayKey, { onlyOpen: false })

  // Global fiado portfolio (all-time), independent of the selected date.
  const allSales = useLiveQuery(() => db.sales.toArray(), [], [] as Sale[])
  const fiadoStats = useMemo(() => {
    const fiadoSales = allSales.filter((s) => s.payMethod === 'fiado')
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
  }, [allSales])

  const fiadosToday = agg.ventasDay.filter((s) => s.payMethod === 'fiado')

  return (
    <div className="p-3.5">
      <p className="mb-3.5 font-display text-[21px] font-bold">Reporte de Caja</p>

      <div className="mb-3.5">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">Filtrar por fecha</label>
        <div className="flex gap-2">
          <input type="date" value={dayKey} onChange={(e) => setDayKey(e.target.value)} className="input flex-1" />
          <button onClick={() => setDayKey(todayKey())} className="rounded-[10px] bg-lime px-4 py-2 text-[13px] font-bold text-black">
            Hoy
          </button>
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5">
        <Kpi label="Ventas del día" value={formatMoney(agg.totalVentas)} color="text-green" sub={`${agg.numTx} transacción${agg.numTx !== 1 ? 'es' : ''}`} />
        <Kpi label="Ganancia bruta" value={formatMoney(agg.totalGanancia)} color="text-lime" sub={`Margen: ${agg.totalVentas ? ((agg.totalGanancia / agg.totalVentas) * 100).toFixed(1) : 0}%`} />
        <Kpi label="Ticket promedio" value={formatMoney(agg.avgTicket)} color="text-blue" sub={`Desc. dados: ${formatMoney(agg.totalDescuentos)}`} />
        <Kpi label="Compras / Gastos" value={formatMoney(agg.totalCompras + agg.totalExOut)} color="text-red" sub={`Extras ingreso: +${formatMoney(agg.totalExIn)}`} />
        <div className="col-span-2 rounded-[14px] border border-br bg-s1 p-4 text-center">
          <div className="text-[10px] uppercase tracking-wider text-muted">Flujo neto del día</div>
          <div className={`my-1.5 font-mono text-[26px] font-bold ${agg.netDay >= 0 ? 'text-lime' : 'text-red'}`}>{formatMoney(agg.netDay)}</div>
          <div className="text-[11px] text-txt2">
            {agg.netDay >= 0 ? '✓ Día positivo' : '⚠ Día negativo'}
            {agg.fiadoTotalDay > 0 ? ` · En caja: ${formatMoney(agg.flujoCaja)}` : ''}
          </div>
        </div>
      </div>

      <p className="mb-2 text-[13px] font-bold uppercase tracking-wide text-txt2">Desglose por pago</p>
      <div className="mb-3.5 rounded-[14px] border border-br bg-s1 p-3.5">
        {(['efectivo', 'transferencia'] as const).map((m) => (
          <div key={m} className="flex justify-between border-b border-br py-2 last:border-b-0">
            <span className="text-[13px]">{PAY_LABEL[m]}</span>
            <span className="font-mono font-semibold">
              {agg.ventasDay.filter((s) => s.payMethod === m).length} · {formatMoney(agg.payBreak[m])}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t border-br pt-2">
          <span className="text-[13px] font-bold text-green">✓ Cobrado en caja</span>
          <span className="font-mono font-bold text-green">{formatMoney(agg.cobradoReal)}</span>
        </div>
        <div className="flex justify-between pt-2">
          <span className="text-[13px] text-red">📋 Fiado (por cobrar)</span>
          <span className="font-mono font-semibold text-red">
            {fiadosToday.length} · {formatMoney(agg.fiadoTotalDay)}
          </span>
        </div>
      </div>

      <p className="mb-2 mt-3.5 text-[13px] font-bold uppercase tracking-wide text-red">📋 Fiados</p>
      <div className="mb-2.5 rounded-xl border border-red/20 bg-red/10 p-3.5">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-red">Fiados generados hoy ({dayKey})</div>
        {!fiadosToday.length ? (
          <div className="text-[13px] text-muted">Sin ventas fiadas en esta fecha ✓</div>
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
                  <div className={`font-mono text-[14px] font-bold ${deuda <= 0 ? 'text-green' : 'text-red'}`}>{deuda <= 0 ? '✓ Pagado' : formatMoney(deuda)}</div>
                  <div className="text-[10px] text-muted">Total: {formatMoney(s.total)}</div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="mb-3.5 rounded-xl border border-br bg-s1 p-3.5">
        <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-muted">📊 Cartera de fiados (todos los tiempos)</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Por cobrar</div>
            <div className="font-mono text-[16px] font-bold text-red">{formatMoney(fiadoStats.debt)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Cobrado</div>
            <div className="font-mono text-[16px] font-bold text-green">{formatMoney(fiadoStats.paid)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Deudores</div>
            <div className="font-mono text-[16px] font-bold text-orange">{fiadoStats.debtors}</div>
          </div>
        </div>
      </div>

      <p className="mb-2 mt-3.5 text-[13px] font-bold uppercase tracking-wide text-txt2">Ventas del período</p>
      {!agg.ventasDay.length ? (
        <div className="p-6 text-center text-muted">
          <p className="text-[13px]">Sin ventas en esta fecha</p>
        </div>
      ) : (
        [...agg.ventasDay].reverse().map((s) => (
          <button key={s.id} onClick={() => setReceiptSale(s)} className="mb-2 block w-full rounded-xl border border-br bg-s1 p-3 text-left">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-[12px] text-lime">{formatSaleId(s.id)}</div>
                <div className="text-[10px] text-muted">{formatDateTime(s.date)}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[15px] font-semibold text-green">{formatMoney(s.total)}</div>
                <div className="text-[11px] text-lime">G: {formatMoney(s.ganancia || 0)}</div>
              </div>
            </div>
          </button>
        ))
      )}

      <button onClick={() => setReporteXOpen(true)} className="mt-2 mb-2.5 w-full rounded-xl border-2 border-blue/30 bg-blue/10 py-3 text-[13px] font-bold text-blue">
        📊 Reporte X — Lectura parcial (sin cerrar caja)
      </button>
      <button onClick={() => setCierreZOpen(true)} className="mb-2.5 w-full rounded-xl border border-red/30 bg-red/10 py-3.5 text-[15px] font-bold text-red">
        🔒 Reporte Z — Cierre definitivo de caja
      </button>
      <button onClick={() => setExtraOpen(true)} className="mb-1 w-full rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
        + Registrar Movimiento (gasto / ingreso extra)
      </button>

      <p className="mb-2 mt-5 text-[13px] font-bold uppercase tracking-wide text-txt2">📁 Historial de cierres</p>
      <CierresHistoryList />

      <p className="mb-2 mt-5 text-[13px] font-bold uppercase tracking-wide text-orange">✏️ Correcciones de facturas</p>
      <CorrectionsHistoryList />

      <ReceiptSheet sale={receiptSale} onClose={() => setReceiptSale(null)} />
      <ReporteXModal open={reporteXOpen} dayKey={dayKey} onClose={() => setReporteXOpen(false)} />
      <CierreZModal open={cierreZOpen} dayKey={dayKey} onClose={() => setCierreZOpen(false)} onClosed={() => setCierreZOpen(false)} />
      <ExtraFormSheet open={extraOpen} onClose={() => setExtraOpen(false)} />
    </div>
  )
}

function Kpi({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div className="rounded-[14px] border border-br bg-s1 p-4 text-center">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`my-1.5 font-mono text-[22px] font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-txt2">{sub}</div>
    </div>
  )
}
