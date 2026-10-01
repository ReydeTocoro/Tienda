import { useLiveQuery } from 'dexie-react-hooks'
import { listAuditLog } from '../../../db/repositories/auditLog'
import type { AuditLogEntry, CorrectionAuditEntry } from '../../../types/auditLog'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatSaleId } from '../../../shared/lib/id'

function isCorrection(e: AuditLogEntry): e is CorrectionAuditEntry {
  return e.type === 'correccion_venta'
}

/** legacy `renderCorrecciones()` (index.html L7076-7099). */
export function CorrectionsHistoryList() {
  const entries = useLiveQuery(() => listAuditLog(), [], [] as AuditLogEntry[])
  const corrections = entries.filter(isCorrection)

  if (!corrections.length) {
    return <div className="py-2 text-[13px] text-muted">Sin correcciones registradas.</div>
  }

  return (
    <div>
      {corrections.map((e) => {
        const diff = e.totalDiff
        const diffColor = diff > 0 ? 'text-green' : diff < 0 ? 'text-red' : 'text-muted'
        const diffStr = diff === 0 ? 'Sin cambio en total' : diff > 0 ? `+${formatMoney(diff)}` : `-${formatMoney(Math.abs(diff))}`
        return (
          <div key={e.id} className="mb-2 rounded-[10px] border-l-4 border-orange bg-s2 p-2.5 text-[12px]">
            <div className="font-mono text-[11px] font-bold text-orange">
              {formatSaleId(e.saleId)} · {formatDateTime(e.date)} <span className={`ml-2 font-mono ${diffColor}`}>{diffStr}</span>
            </div>
            <div className="mt-0.5 leading-relaxed text-txt2">
              <b>Motivo:</b> {e.reason}
              <br />
              <span className="text-muted">
                Antes: {formatMoney(e.before.total)} Después: {formatMoney(e.after.total)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
