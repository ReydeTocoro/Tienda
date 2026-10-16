import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { UserRound, X } from 'lucide-react'
import { listAuditLog } from '../../../db/repositories/auditLog'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { SearchInput } from '../../../shared/components/SearchInput'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatSaleId } from '../../../shared/lib/id'
import type { AuditLogEntry, CorrectionAuditEntry, VoidAuditEntry } from '../../../types/auditLog'

type Change = CorrectionAuditEntry | VoidAuditEntry

const isChange = (e: AuditLogEntry): e is Change => e.type === 'correccion_venta' || e.type === 'anulacion_venta'

/** Entries drawn at once; "Ver más" adds the next ones. */
const PAGE = 40

/** What the search box matches: the invoice's number, why, who, and which kind of change it was. */
function haystack(e: Change): string {
  return [formatSaleId(e.saleId), e.type === 'anulacion_venta' ? 'anulada anulación' : 'corregida corrección', e.reason, e.user].join(' ').toLowerCase()
}

/** Every correction and annulment of an invoice, newest first, each with what it changed, why and who did it.
 * It is the whole history: the audit log never deletes these (Stock → Auditoría only shows its last days). */
export function CorrectionsHistorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // undefined while it is being read: "nothing yet" only once it is known.
  const entries = useLiveQuery(() => (open ? listAuditLog() : Promise.resolve(undefined)), [open])
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)
  const changes = useMemo(() => (entries ?? []).filter(isChange), [entries])
  const found = useMemo(() => {
    // "#0012" and "0012" find the same invoice, as in the list of Facturas.
    const q = search.trim().toLowerCase().replace(/^#/, '')
    return q ? changes.filter((e) => haystack(e).includes(q)) : changes
  }, [changes, search])

  if (!open) return null

  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[640px]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[18px] font-bold">Correcciones y anulaciones de facturas</p>
          <p className="mt-0.5 text-[12px] text-muted">Cada cambio hecho a una factura ya cobrada, del más reciente al más antiguo, con el motivo y quién lo hizo. No se borran.</p>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="flex-shrink-0 rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>

      <div className="mb-3 flex">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setShown(PAGE)
          }}
          historyKey="correcciones"
          placeholder="Buscar factura, motivo o usuario..."
        />
      </div>

      {!found.length ? (
        <div className="p-8 text-center text-[13px] text-muted">
          {!entries ? 'Cargando…' : changes.length ? 'Nada coincide con la búsqueda.' : 'Todavía no se ha corregido ni anulado ninguna factura.'}
        </div>
      ) : (
        <div className="max-h-[440px] overflow-y-auto">
          {found.slice(0, shown).map((e) => (
            <ChangeCard key={e.id} e={e} />
          ))}
          {found.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE)} className="mt-1 w-full rounded-[10px] border border-br2 py-2.5 text-[13px] font-semibold text-txt2 hover:bg-s2">
              Ver más ({found.length - shown} restantes)
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  )
}

function ChangeCard({ e }: { e: Change }) {
  const voided = e.type === 'anulacion_venta'
  // An annulment takes the whole invoice out; a correction moves its total up or down (or not at all).
  const diff = e.type === 'anulacion_venta' ? -e.before.total : e.totalDiff
  const diffColor = diff > 0 ? 'text-green' : diff < 0 ? 'text-red' : 'text-muted'
  return (
    <div className={`mb-2 rounded-[10px] border-l-4 bg-s2 p-2.5 text-[12px] ${voided ? 'border-red' : 'border-orange'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`font-mono text-[12px] font-bold ${voided ? 'text-red' : 'text-orange'}`}>
          {formatSaleId(e.saleId)} {voided ? 'anulada' : 'corregida'}
        </div>
        <div className={`font-mono text-[12px] font-semibold ${diffColor}`}>{diff === 0 ? 'Sin cambio' : `${diff > 0 ? '+' : '−'}${formatMoney(Math.abs(diff))}`}</div>
      </div>
      <div className="mt-1 leading-relaxed text-txt2">
        <b>Motivo:</b> {e.reason}
        {e.type === 'correccion_venta' && (
          <div className="text-muted">
            Antes {formatMoney(e.before.total)} · después {formatMoney(e.after.total)}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-br pt-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1 font-semibold text-txt2">
          <UserRound size={12} />
          {voided ? 'Anuló' : 'Corrigió'}: {e.user || 'sin registrar'}
        </span>
        <span>{formatDateTime(e.date)}</span>
      </div>
    </div>
  )
}
