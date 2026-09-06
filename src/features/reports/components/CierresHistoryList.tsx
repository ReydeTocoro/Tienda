import { useLiveQuery } from 'dexie-react-hooks'
import { listCierres } from '../../../db/repositories/cierres'
import { formatMoney } from '../../../shared/lib/currency'
import { formatCierreId } from '../../../shared/lib/id'

/** legacy `renderCierres()` (index.html L5050-5083). */
export function CierresHistoryList() {
  const cierres = useLiveQuery(() => listCierres(), [], [])

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
              <span className="text-[11px] text-muted">👤 {c.cajero}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <div>
                Ventas: <span className="font-mono font-semibold text-green">{formatMoney(c.totalVentas || 0)}</span>
              </div>
              <div>
                Ganancia: <span className="font-mono font-semibold text-lime">{formatMoney(c.totalGanancia || 0)}</span>
              </div>
              <div>
                Tx: <span className="font-semibold text-blue">{c.numTx || 0}</span>
              </div>
            </div>
            {diff !== undefined && (
              <div className="mt-1.5 text-[11px]">
                Arqueo:{' '}
                <span className={diff === 0 ? 'text-green' : diff > 0 ? 'text-lime' : 'text-red'}>
                  {diff === 0 ? '✓ Cuadre perfecto' : diff > 0 ? `+${formatMoney(diff)} sobrante` : `-${formatMoney(Math.abs(diff))} faltante`}
                </span>
              </div>
            )}
            {c.notas && <div className="mt-1 text-[11px] text-muted">📝 {c.notas}</div>}
          </div>
        )
      })}
    </div>
  )
}
