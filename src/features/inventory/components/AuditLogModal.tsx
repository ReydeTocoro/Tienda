import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { UserRound, X } from 'lucide-react'
import { listAuditLog } from '../../../db/repositories/auditLog'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { SearchInput } from '../../../shared/components/SearchInput'
import { addDaysToKey } from '../../../shared/lib/cash'
import { dayKeyOf, formatDateTime, formatMoney, formatQty, todayKey } from '../../../shared/lib/currency'
import { STOCK_AUDIT_DAYS, type AuditLogEntry } from '../../../types/auditLog'

interface AuditLogModalProps {
  open: boolean
  onClose: () => void
}

const TYPE_LABEL: Record<AuditLogEntry['type'], string> = {
  ajuste: 'Ajuste (suma)',
  merma: 'Ajuste (resta)',
  entrada: 'Entrada de mercancía',
  paquete: 'Paquete',
  importacion: 'Importación',
  nuevo: 'Producto nuevo',
  eliminado: 'Producto eliminado',
  correccion_venta: 'Corrección de venta',
  anulacion_venta: 'Anulación de venta',
  cambio_codigo: 'Cambio de código',
}

/** Entries drawn at once; the search narrows them. */
const SHOWN = 300

/** "Hoy", "Ayer", then the weekday and date ("lunes 12"). */
function dayLabel(dayKey: string, daysAgo: number): string {
  if (daysAgo === 0) return 'Hoy'
  if (daysAgo === 1) return 'Ayer'
  const noon = new Date(`${dayKey}T12:00:00`)
  return `${noon.toLocaleDateString('es-CO', { weekday: 'long' })} ${noon.getDate()}`
}

/** What the search box matches: product, code, who, why. */
function haystack(a: AuditLogEntry): string {
  const parts: Array<string | number | undefined> = [TYPE_LABEL[a.type], a.user]
  if ('reason' in a) parts.push(a.reason)
  if ('name' in a) parts.push(a.name, a.code)
  if ('saleId' in a) parts.push(`venta ${a.saleId}`, `#${a.saleId}`)
  if (a.type === 'cambio_codigo') parts.push(a.oldCode)
  return parts.join(' ').toLowerCase()
}

/** Every change of the stock outside a sale — adjustments with their reason, stock-ins, received orders, packages,
 * imports, products created or deleted with stock — and every correction or annulment of an invoice, each with who
 * did it. Nobody can edit or delete them (the server only ever adds). */
export function AuditLogModal({ open, onClose }: AuditLogModalProps) {
  // undefined while it is being read: "nothing yet" only once it is known.
  const entries = useLiveQuery(() => (open ? listAuditLog() : Promise.resolve(undefined)), [open])
  const [search, setSearch] = useState('')
  const [type, setType] = useState<'' | AuditLogEntry['type']>('')
  // One day at a time, today first: the days kept (older stock movements are deleted by the server).
  const today = todayKey()
  const days = useMemo(() => Array.from({ length: STOCK_AUDIT_DAYS }, (_, i) => addDaysToKey(today, -i)), [today])
  const [dayIndex, setDayIndex] = useState(0)
  const byDay = useMemo(() => {
    const m = new Map<string, AuditLogEntry[]>(days.map((d) => [d, []]))
    for (const a of entries ?? []) m.get(dayKeyOf(a.date))?.push(a)
    return m
  }, [entries, days])
  const found = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (byDay.get(days[dayIndex]) ?? []).filter((a) => (!type || a.type === type) && (!q || haystack(a).includes(q)))
  }, [byDay, days, dayIndex, search, type])

  if (!open) return null

  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[760px]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-display text-[18px] font-bold">Auditoría del stock</p>
          <p className="mt-0.5 text-[12px] text-muted">
            Cada cambio del stock fuera de una venta (las ventas están en Facturas), con quién lo hizo y por qué. Se guardan los últimos {STOCK_AUDIT_DAYS} días; lo más viejo se borra solo.
          </p>
        </div>
        <button onClick={onClose} aria-label="Cerrar" className="rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
          <X size={16} />
        </button>
      </div>

      <div role="tablist" aria-label="Día" className="mb-2.5 flex gap-1.5">
        {days.map((d, i) => (
          <button
            key={d}
            role="tab"
            aria-selected={dayIndex === i}
            onClick={() => setDayIndex(i)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-semibold ${dayIndex === i ? 'border-lime bg-lime/10 text-lime' : 'border-br2 text-txt2 hover:bg-s2'}`}
          >
            {dayLabel(d, i)}
            <span className="font-mono text-[11px] text-muted">{byDay.get(d)?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} historyKey="auditoria" placeholder="Buscar producto, código, usuario o motivo..." />
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Tipo de movimiento" className="input w-auto py-2">
          <option value="">Todos los tipos</option>
          {Object.entries(TYPE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {!found.length ? (
        <div className="p-8 text-center text-muted">
          <p className="text-[13px]">{!entries ? 'Cargando…' : byDay.get(days[dayIndex])?.length ? 'Nada coincide con la búsqueda.' : `Sin movimientos ${dayIndex === 0 ? 'hoy' : 'ese día'}.`}</p>
        </div>
      ) : (
        <div className="max-h-[440px] overflow-y-auto">
          {found.slice(0, SHOWN).map((a) => (
            <div key={a.id} className="mb-2 rounded-xl border border-br bg-s1 p-3">
              <Entry a={a} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-br pt-1.5 text-[11px] text-muted">
                <span className="flex items-center gap-1 font-semibold text-txt2">
                  <UserRound size={12} />
                  {a.user || 'Sin registrar'}
                </span>
                <span>{formatDateTime(a.date)}</span>
              </div>
            </div>
          ))}
          {found.length > SHOWN && <p className="py-2 text-center text-[12px] text-muted">Se muestran los {SHOWN} más recientes de {found.length}: busca para encontrar uno más viejo.</p>}
        </div>
      )}
    </BottomSheet>
  )
}

const Tag = ({ a }: { a: AuditLogEntry }) => <span className="flex-shrink-0 rounded-full bg-s2 px-2 py-0.5 text-[10px] font-bold text-txt2">{TYPE_LABEL[a.type] ?? a.type}</span>

function Entry({ a }: { a: AuditLogEntry }) {
  if (a.type === 'correccion_venta') {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[12px] font-bold text-orange">Venta #{a.saleId}</div>
          <div className={`font-mono text-[12px] ${a.totalDiff > 0 ? 'text-green' : a.totalDiff < 0 ? 'text-red' : 'text-muted'}`}>
            {a.totalDiff === 0 ? 'Sin cambio' : `${a.totalDiff > 0 ? '+' : '−'}${formatMoney(Math.abs(a.totalDiff))}`}
          </div>
        </div>
        <div className="mt-1 text-[12px] text-txt2">
          <Tag a={a} /> <b>Motivo:</b> {a.reason}
          <div className="text-muted">
            Antes {formatMoney(a.before.total)} · después {formatMoney(a.after.total)}
          </div>
        </div>
      </>
    )
  }
  if (a.type === 'anulacion_venta') {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[12px] font-bold text-red">Venta #{a.saleId} anulada</div>
          <div className="font-mono text-[12px] text-red">−{formatMoney(a.before.total)}</div>
        </div>
        <div className="mt-1 text-[12px] text-txt2">
          <Tag a={a} /> <b>Motivo:</b> {a.reason}
        </div>
      </>
    )
  }
  if (a.type === 'cambio_codigo') {
    return (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold">{a.name}</div>
            <div className="font-mono text-[11px] text-muted">
              {a.oldCode} → <b className="text-txt2">{a.code}</b>
            </div>
          </div>
          <Tag a={a} />
        </div>
        <div className="mt-1 text-[12px] text-txt2">
          Pasaron al código nuevo {a.ventas} venta{a.ventas !== 1 ? 's' : ''} y {a.pedidos} pedido{a.pedidos !== 1 ? 's' : ''} abierto{a.pedidos !== 1 ? 's' : ''}
        </div>
      </>
    )
  }
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold">{a.name}</div>
          <div className="font-mono text-[10px] text-muted">{a.code}</div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className={`font-mono text-[18px] font-extrabold ${a.diff > 0 ? 'text-green' : a.diff < 0 ? 'text-red' : 'text-muted'}`}>
            {a.diff > 0 ? '+' : ''}
            {formatQty(a.diff)}
          </div>
          <div className="font-mono text-[10px] text-muted">
            {formatQty(a.before)} → {formatQty(a.after)}
          </div>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-txt2">
        <Tag a={a} />
        <span>{a.reason}</span>
      </div>
    </>
  )
}
