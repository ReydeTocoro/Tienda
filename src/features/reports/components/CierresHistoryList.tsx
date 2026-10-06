import { useMemo } from 'react'
import { useSecureTable } from '../../../db/secure'
import { useProfits } from '../../../shared/hooks/useSecretFigures'
import { formatMoney } from '../../../shared/lib/currency'
import { formatCierreId } from '../../../shared/lib/id'
import { usePermission } from '../../pin/usePermission'

/** legacy `renderCierres()` (index.html L5050-5083). The cierres only reach this device for whoever
 * may see reports, and their profit only for whoever may see profits. */
export function CierresHistoryList() {
  const stored = useSecureTable('cierres')
  const cierres = useMemo(() => [...stored].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)), [stored])
  const profits = useProfits().cierres
  const showProfit = usePermission().can('ganancias.ver')

  if (!cierres.length) {
    return <div className="py-2 text-[13px] text-muted">Sin cierres registrados aún.</div>
  }

  return (
    <div>
      {cierres.map((c) => {
        const d = new Date(c.cerradoEn || c.fecha)
        const diff = c.arqueo?.diferencia
        return (
          <div key={c.id} className="mb-2 rounded-xl border border-br bg-s2 p-3">
            <div className="mb-1.5 flex items-start justify-between">
              <div>
                <span className="font-mono text-[12px] font-bold text-txt2">{formatCierreId(c.id)}</span>
                <span className="ml-2 text-[12px] text-muted">
                  {d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })} {d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <span className="text-[11px] text-muted">{c.cajero}</span>
            </div>
            <div className={`grid gap-1.5 text-[11px] ${showProfit ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div>
                Ventas: <span className="font-mono font-semibold text-green">{formatMoney(c.totalVentas || 0)}</span>
              </div>
              {showProfit && (
                <div>
                  Ganancia: <span className="font-mono font-semibold text-lime">{formatMoney(profits.get(c.id ?? -1) ?? 0)}</span>
                </div>
              )}
              <div>
                Tx: <span className="font-semibold text-blue">{c.numTx || 0}</span>
              </div>
            </div>
            {diff !== undefined && (
              <div className="mt-1.5 text-[11px]">
                Arqueo:{' '}
                <span className={diff === 0 ? 'text-green' : diff > 0 ? 'text-lime' : 'text-red'}>
                  {diff === 0 ? 'Cuadre perfecto' : diff > 0 ? `+${formatMoney(diff)} sobrante` : `-${formatMoney(Math.abs(diff))} faltante`}
                </span>
              </div>
            )}
            {c.traslado !== undefined && (
              <div className="mt-1 text-[11px] text-txt2">
                Trasladado a Caja Mayor: <span className="font-mono font-semibold text-lime">{formatMoney(c.traslado)}</span>
                {c.dejadoEnCaja !== undefined && <> · Quedó en caja: <span className="font-mono font-semibold">{formatMoney(c.dejadoEnCaja)}</span></>}
              </div>
            )}
            {c.notas && <div className="mt-1 text-[11px] text-muted">{c.notas}</div>}
          </div>
        )
      })}
    </div>
  )
}
