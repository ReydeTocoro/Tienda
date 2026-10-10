import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { listAuditLog } from '../../../db/repositories/auditLog'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { formatDateTime } from '../../../shared/lib/currency'

interface AuditLogModalProps {
  open: boolean
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  merma: 'Merma',
  ajuste: 'Ajuste',
  importacion: 'Importación',
  correccion_venta: 'Corrección de venta',
  cambio_codigo: 'Cambio de código',
}

/** Read-only audit trail viewer — legacy `renderAuditList()` (index.html L5830-5862). */
export function AuditLogModal({ open, onClose }: AuditLogModalProps) {
  const entries = useLiveQuery(() => (open ? listAuditLog() : Promise.resolve([])), [open], [])

  if (!open) return null

  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[720px]">
      <div className="mb-3.5 flex items-center justify-between">
        <div>
          <p className="font-display text-[18px] font-bold">Log de Auditoría</p>
          <p className="mt-0.5 text-[12px] text-muted">Registro inalterable de todos los ajustes de inventario</p>
        </div>
        <button onClick={onClose} className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>

      {!entries.length ? (
        <div className="p-8 text-center text-muted">
          <p className="text-[13px]">Sin ajustes registrados aún.</p>
        </div>
      ) : (
        <div className="max-h-[460px] overflow-y-auto">
          {entries.map((a) => (
            <div key={a.id} className="mb-2 rounded-xl border border-br bg-s1 p-3">
              {a.type === 'correccion_venta' ? (
                <>
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[12px] font-bold text-orange">Venta #{a.saleId}</div>
                    <div className={`font-mono text-[12px] ${a.totalDiff > 0 ? 'text-green' : a.totalDiff < 0 ? 'text-red' : 'text-muted'}`}>
                      {a.totalDiff === 0 ? 'Sin cambio' : a.totalDiff > 0 ? `+$${a.totalDiff.toFixed(2)}` : `-$${Math.abs(a.totalDiff).toFixed(2)}`}
                    </div>
                  </div>
                  <div className="mt-1 text-[12px] text-txt2">
                    <b>Motivo:</b> {a.reason}
                    <br />
                    <span className="text-muted">
                      Antes: ${a.before.total.toFixed(2)} Después: ${a.after.total.toFixed(2)}
                    </span>
                  </div>
                </>
              ) : a.type === 'cambio_codigo' ? (
                <>
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold">{a.name}</div>
                      <div className="font-mono text-[11px] text-muted">
                        {a.oldCode} → <b className="text-txt2">{a.code}</b>
                      </div>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-s2 px-2 py-0.5 text-[10px] font-bold text-txt2">{TYPE_LABEL[a.type]}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[12px] text-txt2">
                      Pasaron al código nuevo {a.ventas} venta{a.ventas !== 1 ? 's' : ''} y {a.pedidos} pedido{a.pedidos !== 1 ? 's' : ''} abierto{a.pedidos !== 1 ? 's' : ''}
                    </span>
                    <div className="text-[10px] text-muted">
                      {formatDateTime(a.date)}
                      {a.user ? ' · ' + a.user : ''}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-1.5 flex items-start justify-between">
                    <div>
                      <div className="text-[13px] font-bold">{a.name}</div>
                      <div className="font-mono text-[10px] text-muted">{a.code}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-[18px] font-extrabold ${a.diff > 0 ? 'text-lime' : a.diff < 0 ? 'text-red' : 'text-muted'}`}>
                        {a.diff > 0 ? '+' : ''}
                        {a.diff}
                      </div>
                      <div className="text-[10px] text-muted">
                        {a.before} {a.after}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div>
                      <span className="rounded-full bg-s2 px-2 py-0.5 text-[10px] font-bold text-txt2">{TYPE_LABEL[a.type] || a.type}</span>
                      <span className="ml-2 text-[12px] text-txt2">{a.reason}</span>
                    </div>
                    <div className="text-[10px] text-muted">
                      {formatDateTime(a.date)}
                      {a.user ? ' · ' + a.user : ''}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  )
}
