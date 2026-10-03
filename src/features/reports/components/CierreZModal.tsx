import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDayAggregation } from '../../../shared/hooks/useDayAggregation'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { confirmCierreZ } from '../../../db/repositories/cierres'
import { getSettings, updateSettings } from '../../../db/repositories/settings'
import { round2 } from '../../../shared/lib/cash'
import { toast } from '../../../store/useToastStore'
import { formatMoney } from '../../../shared/lib/currency'
import { usePermission } from '../../pin/usePermission'
import { useCaja } from '../../cash/hooks/useCaja'

interface CierreZModalProps {
  open: boolean
  dayKey: string
  onClose: () => void
  onClosed: () => void
}

/** Non-destructive Cierre Z with cash-count (arqueo) — legacy `cerrarCaja()`/`confirmarCierreZ()`
 * (index.html L5941-6067). It is also how the Caja Menor workday ends: the expected cash is the
 * drawer's ledger balance, and part of what was counted can be moved to the Caja Mayor right
 * here. Only the still-open rows for `dayKey` get marked with the new cierre's id — nothing is
 * deleted (plan decision 2). */
export function CierreZModal({ open, dayKey, onClose, onClosed }: CierreZModalProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[440px]">
      <CierreZForm dayKey={dayKey} onClose={onClose} onClosed={onClosed} />
    </BottomSheet>
  )
}

function CierreZForm({ dayKey, onClose, onClosed }: Omit<CierreZModalProps, 'open'>) {
  const agg = useDayAggregation(dayKey, { onlyOpen: true })
  const { menor, session } = useCaja()
  const settings = useLiveQuery(() => getSettings())
  const { currentUserName } = usePermission()
  const [cajero, setCajero] = useState('')
  const [efectivoFisico, setEfectivoFisico] = useState<number | null>(null)
  const [transferOn, setTransferOn] = useState(true)
  const [trasladarInput, setTrasladarInput] = useState<number | null>(null)
  const [notas, setNotas] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!cajero) setCajero(currentUserName || settings?.lastCajero || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserName, settings?.lastCajero])

  const hasFisico = efectivoFisico !== null
  const fisico = efectivoFisico ?? 0
  const diferencia = round2(fisico - menor)
  const base = settings?.cajaBase ?? 0
  const sugerido = Math.max(0, round2(fisico - base))
  const trasladar = transferOn ? (trasladarInput ?? sugerido) : 0
  const tooMuch = trasladar > fisico + 0.005
  const quedaEnCaja = round2(fisico - trasladar)

  async function confirm() {
    if (!cajero.trim()) {
      toast('Ingresa el nombre del cajero', 'orange')
      return
    }
    if (!hasFisico) {
      toast('Ingresa el efectivo contado', 'orange')
      return
    }
    if (tooMuch) {
      toast('No puedes trasladar más de lo que contaste', 'orange')
      return
    }
    if (!agg.ventasDay.length && !agg.movementsDay.length && !session) {
      toast('No hay movimientos en esa fecha', 'orange')
      return
    }
    setBusy(true)
    try {
      await confirmCierreZ({ dayKey, cajero: cajero.trim(), notas: notas.trim(), efectivoFisico: fisico, trasladar, aggregate: agg })
      await updateSettings({ lastCajero: cajero.trim(), ...(trasladar > 0 ? { cajaBase: quedaEnCaja } : {}) })
      const diffMsg = diferencia === 0 ? ' · Cuadre perfecto' : ` · Diferencia: ${formatMoney(diferencia)}`
      const moveMsg = trasladar > 0 ? ` · ${formatMoney(trasladar)} a Caja Mayor` : ''
      toast(`Caja cerrada por ${cajero.trim()}${diffMsg}${moveMsg}`, 'green')
      onClosed()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-1 font-display text-[18px] font-bold">Reporte Z — Cierre definitivo</div>
      <div className="mb-4 text-[12px] text-muted">Fecha: {dayKey}</div>

      <div className="mb-3.5 rounded-xl bg-s2 p-3.5">
        <div className="mb-2 field-label">Según el sistema</div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Ventas" value={formatMoney(agg.totalVentas)} color="text-green" />
          <Stat label="Ganancia" value={formatMoney(agg.totalGanancia)} color="text-lime" />
          <Stat label="Transacc." value={String(agg.numTx)} color="text-blue" />
          <Stat label="Efectivo esperado en caja" value={formatMoney(menor)} color="text-txt" />
          {agg.totalExIn > 0 && <Stat label="Otros ingresos (abonos, etc.)" value={formatMoney(agg.totalExIn)} color="text-lime" />}
          {agg.totalExOut > 0 && <Stat label="Egresos de caja" value={formatMoney(agg.totalExOut)} color="text-orange" />}
          {agg.fiadoTotalDay > 0 && <Stat label="Fiado (no en caja)" value={formatMoney(agg.fiadoTotalDay)} color="text-red" span2 />}
          <div className="col-span-2 border-t border-br pt-1.5">
            <div className="field-label">Flujo neto</div>
            <div className={`font-mono text-[18px] font-extrabold ${agg.netDay >= 0 ? 'text-lime' : 'text-red'}`}>{formatMoney(agg.netDay)}</div>
          </div>
        </div>
      </div>

      <div className="mb-2 field-label">Arqueo físico — Efectivo contado</div>
      <div className="mb-2.5 rounded-xl bg-s2 p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="whitespace-nowrap text-[13px] text-txt2">Billetes + monedas:</span>
          <div className="flex-1">
            <MoneyInput className="input border-2 border-lime text-right font-mono text-lime" value={fisico} onChange={(v) => setEfectivoFisico(v ?? null)} placeholder="0" />
          </div>
        </div>
        {hasFisico && (
          <div
            className={`mt-2.5 rounded-lg p-2 text-center ${diferencia === 0 ? 'bg-green/10' : Math.abs(diferencia) < 5 ? 'bg-orange/10' : 'bg-red/10'}`}
          >
            <div className="text-[11px] text-muted">Diferencia</div>
            <div className={`font-mono text-[22px] font-extrabold ${diferencia === 0 ? 'text-green' : diferencia > 0 ? 'text-lime' : 'text-red'}`}>
              {diferencia >= 0 ? '+' : ''}
              {formatMoney(diferencia)}
            </div>
            <div className="text-[11px]">{diferencia === 0 ? 'Cuadre perfecto' : diferencia > 0 ? 'Sobrante en caja' : 'Faltante en caja'}</div>
          </div>
        )}
      </div>

      {hasFisico && (
        <div className="mb-3.5 rounded-xl border border-br2 p-3.5">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
            <input type="checkbox" checked={transferOn} onChange={(e) => setTransferOn(e.target.checked)} className="h-4 w-4 accent-lime" />
            Trasladar fondos a Caja Mayor
          </label>
          {transferOn && (
            <div className="mt-2.5">
              <div className="mb-1 field-label">Monto a trasladar</div>
              <MoneyInput className="input text-right font-mono font-bold" value={trasladar} onChange={(v) => setTrasladarInput(v ?? 0)} />
              {tooMuch ? (
                <div className="mt-1.5 text-[12px] font-semibold text-red">No puedes trasladar más de lo que contaste.</div>
              ) : (
                <div className="mt-1.5 text-[12px] text-txt2">
                  Queda en caja para mañana: <b className="font-mono">{formatMoney(quedaEnCaja)}</b>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <label className="mb-1 block field-label">Cajero responsable *</label>
      <input className="input mb-2.5 border-lime" value={cajero} onChange={(e) => setCajero(e.target.value)} placeholder="Nombre del cajero" />
      <label className="mb-1 block field-label">Observaciones del cierre</label>
      <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: $20 de faltante por cambio dado sin registrar..." className="input mb-4 resize-none" />

      <div className="mb-4 rounded-[10px] border border-red/20 bg-red/10 px-3 py-2.5 text-[12px] text-txt2">
        El Reporte Z es definitivo. Las ventas de este día quedan marcadas como cerradas (siguen visibles en Facturas/Reporte para siempre) y la caja se cierra.
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy} onClick={confirm} className="flex-[2] rounded-[10px] bg-red py-2.5 text-[14px] font-extrabold text-on-solid disabled:opacity-60">
          Confirmar Cierre Z
        </button>
      </div>
    </>
  )
}

function Stat({ label, value, color, span2 }: { label: string; value: string; color: string; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <div className="field-label">{label}</div>
      <div className={`font-mono text-[15px] font-bold ${color}`}>{value}</div>
    </div>
  )
}
