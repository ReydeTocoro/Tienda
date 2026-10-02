import { CAJA_LABEL, CATEGORY_LABEL, MOVEMENT_LABEL } from '../../../shared/lib/cash'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import type { CashMovement } from '../../../types/cash'

export function MovementList({ movements, showCaja }: { movements: CashMovement[]; showCaja: boolean }) {
  if (!movements.length) {
    return <div className="rounded-xl border border-dashed border-br2 p-8 text-center text-[13px] text-muted">Sin movimientos con estos filtros.</div>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-br bg-s1">
      {movements.map((m) => {
        const incoming = m.direction === 'in'
        return (
          <div key={m.id} className="flex items-center justify-between gap-3 border-b border-br px-3.5 py-2.5 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{m.concept}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                <span className="rounded-full border border-br2 bg-s2 px-1.5 py-px text-[10px] font-semibold text-txt2">{MOVEMENT_LABEL[m.type]}</span>
                {m.medio === 'transferencia' && <span className="rounded-full border border-blue/30 bg-blue/10 px-1.5 py-px text-[10px] font-semibold text-blue">Transferencia</span>}
                {m.category && <span>{CATEGORY_LABEL[m.category]}</span>}
                {showCaja && <span>{CAJA_LABEL[m.caja]}</span>}
                <span>{formatDateTime(m.date)}</span>
                {m.by && <span>· {m.by}</span>}
              </div>
            </div>
            <div className={`flex-shrink-0 font-mono text-[14px] font-bold ${incoming ? 'text-green' : 'text-red'}`}>
              {incoming ? '+' : '−'}
              {formatMoney(m.amount)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
