import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDayAggregation } from '../../../shared/hooks/useDayAggregation'
import { Modal } from '../../../shared/components/Modal'
import { confirmCierreZ } from '../../../db/repositories/cierres'
import { getSettings, updateSettings } from '../../../db/repositories/settings'
import { toast } from '../../../store/useToastStore'
import { formatMoney } from '../../../shared/lib/currency'

interface CierreZModalProps {
  open: boolean
  dayKey: string
  onClose: () => void
  onClosed: () => void
}

/** Non-destructive Cierre Z with cash-count (arqueo) — legacy `cerrarCaja()`/`confirmarCierreZ()`
 * (index.html L5941-6067). Only the still-open rows for `dayKey` (per `computeDayAggregate`'s
 * `onlyOpen` mode) get marked with the new cierre's id — nothing is deleted (plan decision 2). */
export function CierreZModal({ open, dayKey, onClose, onClosed }: CierreZModalProps) {
  const agg = useDayAggregation(dayKey, { onlyOpen: true })
  const settings = useLiveQuery(() => getSettings())
  const [cajero, setCajero] = useState('')
  const [efectivoFisico, setEfectivoFisico] = useState('')
  const [notas, setNotas] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && !cajero && settings?.lastCajero) setCajero(settings.lastCajero)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings?.lastCajero])

  if (!open) return null

  const fisico = parseFloat(efectivoFisico) || 0
  const diferencia = fisico - agg.payBreak.efectivo
  const hasFisico = efectivoFisico.trim() !== ''

  async function confirm() {
    if (!cajero.trim()) {
      toast('⚠ Ingresa el nombre del cajero', 'orange')
      return
    }
    if (!hasFisico) {
      toast('⚠ Ingresa el efectivo contado', 'orange')
      return
    }
    if (!agg.ventasDay.length && !agg.extrasDay.length && !agg.comprasDay.length) {
      toast('⚠ No hay movimientos en esa fecha', 'orange')
      return
    }
    setBusy(true)
    try {
      await confirmCierreZ({ dayKey, cajero: cajero.trim(), notas: notas.trim(), efectivoFisico: fisico, aggregate: agg })
      await updateSettings({ lastCajero: cajero.trim() })
      const diffMsg = diferencia === 0 ? ' · Cuadre perfecto ✓' : ` · Diferencia: ${formatMoney(diferencia)}`
      toast(`✓ Caja cerrada por ${cajero.trim()}${diffMsg}`, 'green')
      setEfectivoFisico('')
      setNotas('')
      onClosed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidthClass="max-w-[420px]">
      <div className="mb-1 font-display text-[18px] font-bold">🔒 Reporte Z — Cierre definitivo</div>
      <div className="mb-4 text-[12px] text-muted">Fecha: {dayKey}</div>

      <div className="mb-3.5 rounded-xl bg-s2 p-3.5">
        <div className="mb-2 field-label">📊 Según el sistema</div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Ventas" value={formatMoney(agg.totalVentas)} color="text-green" />
          <Stat label="Ganancia" value={formatMoney(agg.totalGanancia)} color="text-lime" />
          <Stat label="Transacc." value={String(agg.numTx)} color="text-blue" />
          <Stat label="💵 Efect. sistema" value={formatMoney(agg.payBreak.efectivo)} color="text-txt" />
          {agg.fiadoTotalDay > 0 && <Stat label="📋 Fiado (no en caja)" value={formatMoney(agg.fiadoTotalDay)} color="text-red" span2 />}
          <div className="col-span-2 border-t border-br pt-1.5">
            <div className="field-label">Flujo neto</div>
            <div className={`font-mono text-[18px] font-extrabold ${agg.netDay >= 0 ? 'text-lime' : 'text-red'}`}>{formatMoney(agg.netDay)}</div>
          </div>
        </div>
      </div>

      <div className="mb-2 field-label">💵 Arqueo físico — Efectivo contado</div>
      <div className="mb-2.5 rounded-xl bg-s2 p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="whitespace-nowrap text-[13px] text-txt2">Billetes + monedas:</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={efectivoFisico}
            onChange={(e) => setEfectivoFisico(e.target.value)}
            placeholder="0.00"
            className="input flex-1 border-2 border-lime text-right font-mono text-lime"
          />
        </div>
        {hasFisico && (
          <div
            className="mt-2.5 rounded-lg p-2 text-center"
            style={{ background: diferencia === 0 ? 'rgba(107,255,184,0.1)' : Math.abs(diferencia) < 5 ? 'rgba(240,160,96,0.1)' : 'rgba(255,107,107,0.1)' }}
          >
            <div className="text-[11px] text-muted">Diferencia</div>
            <div className={`font-mono text-[22px] font-extrabold ${diferencia === 0 ? 'text-green' : diferencia > 0 ? 'text-lime' : 'text-red'}`}>
              {diferencia >= 0 ? '+' : ''}
              {formatMoney(diferencia)}
            </div>
            <div className="text-[11px]">{diferencia === 0 ? '✓ Cuadre perfecto' : diferencia > 0 ? 'Sobrante en caja' : 'Faltante en caja'}</div>
          </div>
        )}
      </div>

      <label className="mb-1 block field-label">👤 Cajero responsable *</label>
      <input className="input mb-2.5 border-lime" value={cajero} onChange={(e) => setCajero(e.target.value)} placeholder="Nombre del cajero" />
      <label className="mb-1 block field-label">📝 Observaciones del cierre</label>
      <textarea
        rows={2}
        value={notas}
        onChange={(e) => setNotas(e.target.value)}
        placeholder="Ej: $20 de faltante por cambio dado sin registrar..."
        className="input mb-4 resize-none"
      />

      <div className="mb-4 rounded-[10px] border border-red/20 bg-red/10 px-3 py-2.5 text-[12px] text-txt2">
        ⚠️ El Reporte Z es definitivo. Las ventas de este día quedan marcadas como cerradas (siguen visibles en Historial/Reporte para siempre).
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy} onClick={confirm} className="flex-[2] rounded-[10px] bg-red py-2.5 text-[14px] font-extrabold text-white disabled:opacity-60">
          🔒 Confirmar Cierre Z
        </button>
      </div>
    </Modal>
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
