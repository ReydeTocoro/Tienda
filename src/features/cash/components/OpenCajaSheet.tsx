import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { openCaja } from '../../../db/repositories/cash'
import { formatMoney } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import { useMayorStore } from '../../../store/useMayorStore'
import { useActorName, useCaja } from '../hooks/useCaja'
import { openMayor } from '../mayorEye'
import { usePermission } from '../../pin/usePermission'

interface OpenCajaSheetProps {
  open: boolean
  onClose: () => void
}

/** Start of the Caja Menor workday: count what is in the drawer; any gap against what the ledger
 * expected is recorded, not hidden. The very first opening doubles as the starting point of the
 * books (base of the Caja Menor and, optionally, what the safe and banks already hold). When the
 * drawer holds more or less than the books say, the person says what happened to the gap: it was
 * the day's base taken out of the Caja Mayor (or cash carried to it) — a transfer, so both cajas
 * stay right — or it is just a sobrante or a faltante. */
export function OpenCajaSheet({ open, onClose }: OpenCajaSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[440px]">
      <OpenCajaForm onClose={onClose} />
    </BottomSheet>
  )
}

/** What was said about the gap. It belongs to one direction (more or less cash than the books), so changing the
 * count across zero asks again. */
type Choice = { kind: 'mayor' | 'ajuste'; sign: 1 | -1 }

function OpenCajaForm({ onClose }: { onClose: () => void }) {
  const { menor, mayor, balancesKnown, firstOpening } = useCaja()
  const actor = useActorName()
  const { can, operator } = usePermission()
  const mayorOpen = useMayorStore((s) => s.open)
  // Without "ver el efectivo esperado" the drawer is counted blind: no expected figure, no prefill,
  // no difference shown — it's still recorded for the administrator.
  const blind = !firstOpening && !can('caja.verEsperado')
  const [counted, setCounted] = useState<number | null>(null)
  const [mayorInitial, setMayorInitial] = useState(0)
  const [by, setBy] = useState<string | null>(null)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [busy, setBusy] = useState(false)

  const value = counted ?? (blind ? 0 : menor)
  const who = (operator?.name ?? by ?? actor).trim()
  const diff = Math.round((value - menor) * 100) / 100
  const sign = diff > 0 ? 1 : -1
  // A gap against the books asks what happened to it — not on the first opening (its cash is the base) nor counting
  // blind (the gap isn't known to whoever counts).
  const asks = !blind && !firstOpening && diff !== 0
  // The Caja Mayor's figure is only seen once its eye is open; a base can't come out of it if it has less.
  const mayorShort = asks && diff > 0 && mayorOpen && balancesKnown && mayor + 0.005 < diff
  const picked = asks && choice?.sign === sign && !(mayorShort && choice.kind === 'mayor') ? choice.kind : null

  /** Money moving into or out of the Caja Mayor needs it open (its eye, with a PIN), as everywhere else. */
  async function chooseMayor() {
    if (await openMayor()) setChoice({ kind: 'mayor', sign })
  }

  async function submit() {
    if (!who) {
      toast('Indica quién abre la caja', 'orange')
      return
    }
    if (blind && counted === null) {
      toast('Escribe el efectivo que contaste', 'orange')
      return
    }
    if (asks && !picked) {
      toast('Elige qué pasó con la diferencia', 'orange')
      return
    }
    setBusy(true)
    try {
      const settle = picked === 'mayor'
      const session = await openCaja({ countedCash: value, by: who, mayorInitial: firstOpening && mayorInitial > 0 ? mayorInitial : undefined, ...(settle ? { settleWith: 'mayor' as const } : {}) })
      // A server that doesn't know the new way would book it as a sobrante or faltante without saying so.
      if (settle && session.openSettledWith !== 'mayor') toast('La caja se abrió, pero el servidor aún no tiene la versión nueva: la diferencia quedó como sobrante o faltante, no como traslado.', 'red')
      else toast(firstOpening ? 'Cajas iniciadas' : 'Caja abierta', 'green')
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
          : blind
            ? 'Cuenta billetes y monedas y escribe el total. El sistema lo compara con lo esperado; el resultado lo ve el administrador.'
            : 'Cuenta el efectivo que hay en la caja antes de empezar a vender.'}
      </div>

      {!firstOpening && !blind && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-s2 px-3.5 py-2.5 text-[13px]">
          <span className="text-txt2">Según el sistema</span>
          <span className="font-mono font-bold">{formatMoney(menor)}</span>
        </div>
      )}

      <label className="mb-1 block field-label">{firstOpening ? 'Efectivo en la caja (base inicial) *' : 'Efectivo contado *'}</label>
      <MoneyInput
        className="input mb-2 border-lime text-right font-mono text-[20px] font-bold text-lime"
        value={value}
        onChange={(v) => setCounted(blind ? v : (v ?? 0))}
        placeholder="0"
        autoFocus
      />
      {asks && (
        <div role="radiogroup" aria-label="Qué pasó con la diferencia" className="mb-3">
          <div className={`mb-2 rounded-lg px-3 py-2 text-center text-[12px] font-semibold ${diff > 0 ? 'bg-lime/10 text-lime' : 'bg-red/10 text-red'}`}>
            {diff > 0 ? `Hay ${formatMoney(diff)} más de lo que dice el sistema. ¿De dónde salió ese efectivo?` : `Hay ${formatMoney(-diff)} menos de lo que dice el sistema. ¿Qué pasó con ese efectivo?`}
          </div>
          <div className="space-y-1.5">
            <ChoiceCard
              selected={picked === 'mayor'}
              disabled={mayorShort}
              onClick={chooseMayor}
              title={diff > 0 ? 'Lo saqué de la Caja Mayor (la base del día)' : 'Lo llevé a la Caja Mayor (caja fuerte o banco)'}
              hint={
                mayorShort
                  ? `La Caja Mayor solo tiene ${formatMoney(mayor)}.`
                  : diff > 0
                    ? 'Se traslada de la Caja Mayor a la Caja Menor: las dos cajas quedan cuadradas. Pide el PIN si la Mayor está cerrada.'
                    : 'Se anota el traslado de la Caja Menor a la Caja Mayor que faltó registrar. Pide el PIN si la Mayor está cerrada.'
              }
            />
            <ChoiceCard
              selected={picked === 'ajuste'}
              onClick={() => setChoice({ kind: 'ajuste', sign })}
              title={diff > 0 ? 'Es un sobrante' : 'Es un faltante'}
              hint={diff > 0 ? 'No sé de dónde salió: queda anotado como sobrante al abrir caja.' : 'Se perdió o no sé qué pasó: queda anotado como faltante al abrir caja.'}
            />
          </div>
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
      <input className="input mb-4" value={operator?.name ?? by ?? actor} onChange={(e) => setBy(e.target.value)} readOnly={!!operator} placeholder="Nombre" />

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button data-enter disabled={busy || (asks && !picked)} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-60">
          {firstOpening ? 'Iniciar cajas' : 'Abrir caja'}
        </button>
      </div>
    </>
  )
}

function ChoiceCard({ selected, disabled, onClick, title, hint }: { selected: boolean; disabled?: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${selected ? 'border-lime bg-lime/10' : 'border-br2 hover:bg-s2'}`}
    >
      <span aria-hidden className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-lime' : 'border-br2'}`}>
        {selected && <span className="h-2 w-2 rounded-full bg-lime" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-[11px] text-muted">{hint}</span>
      </span>
    </button>
  )
}
