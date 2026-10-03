import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { openCaja } from '../../../db/repositories/cash'
import { formatMoney } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import { useActorName, useCaja } from '../hooks/useCaja'

interface OpenCajaSheetProps {
  open: boolean
  onClose: () => void
}

/** Start of the Caja Menor workday: count what is in the drawer; any gap against what the ledger
 * expected is recorded, not hidden. The very first opening doubles as the starting point of the
 * books (base of the Caja Menor and, optionally, what the safe and banks already hold). */
export function OpenCajaSheet({ open, onClose }: OpenCajaSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[440px]">
      <OpenCajaForm onClose={onClose} />
    </BottomSheet>
  )
}

function OpenCajaForm({ onClose }: { onClose: () => void }) {
  const { menor, firstOpening } = useCaja()
  const actor = useActorName()
  const [counted, setCounted] = useState<number | null>(null)
  const [mayorInitial, setMayorInitial] = useState(0)
  const [by, setBy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const value = counted ?? menor
  const who = (by ?? actor).trim()
  const diff = Math.round((value - menor) * 100) / 100

  async function submit() {
    if (!who) {
      toast('Indica quién abre la caja', 'orange')
      return
    }
    setBusy(true)
    try {
      await openCaja({ countedCash: value, by: who, mayorInitial: firstOpening && mayorInitial > 0 ? mayorInitial : undefined })
      toast(firstOpening ? 'Cajas iniciadas' : 'Caja abierta', 'green')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-1 font-display text-[18px] font-bold">{firstOpening ? 'Apertura inicial de cajas' : 'Abrir Caja Menor'}</div>
      <div className="mb-4 text-[12px] text-muted">
        {firstOpening
          ? 'Es el punto de partida de las cajas. Registra el efectivo de hoy; las ventas anteriores a este sistema no se incluyen.'
          : 'Cuenta el efectivo que hay en la caja antes de empezar a vender.'}
      </div>

      {!firstOpening && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-s2 px-3.5 py-2.5 text-[13px]">
          <span className="text-txt2">Según el sistema</span>
          <span className="font-mono font-bold">{formatMoney(menor)}</span>
        </div>
      )}

      <label className="mb-1 block field-label">{firstOpening ? 'Efectivo en la caja (base inicial) *' : 'Efectivo contado *'}</label>
      <MoneyInput className="input mb-2 border-lime text-right font-mono text-[20px] font-bold text-lime" value={value} onChange={(v) => setCounted(v ?? 0)} autoFocus />
      {diff !== 0 && (!firstOpening || diff < 0) && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-center text-[12px] font-semibold ${diff > 0 ? 'bg-lime/10 text-lime' : 'bg-red/10 text-red'}`}>
          {diff > 0 ? `Sobrante de ${formatMoney(diff)}` : `Faltante de ${formatMoney(-diff)}`} — queda registrado en la caja
        </div>
      )}

      {firstOpening && (
        <>
          <label className="mb-1 mt-2 block field-label">Saldo inicial de Caja Mayor (caja fuerte + bancos)</label>
          <MoneyInput className="input mb-1 text-right font-mono font-bold" value={mayorInitial} onChange={(v) => setMayorInitial(v ?? 0)} placeholder="0" />
          <div className="mb-2 text-[11px] text-muted">Opcional. Lo que ya tienes guardado, para que la liquidez real arranque correcta.</div>
        </>
      )}

      <label className="mb-1 mt-2 block field-label">Quién abre *</label>
      <input className="input mb-4" value={by ?? actor} onChange={(e) => setBy(e.target.value)} placeholder="Nombre" />

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
          {firstOpening ? 'Iniciar cajas' : 'Abrir caja'}
        </button>
      </div>
    </>
  )
}
