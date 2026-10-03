import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { transferFunds } from '../../../db/repositories/cash'
import { CAJA_LABEL, round2 } from '../../../shared/lib/cash'
import { formatMoney } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'
import type { CajaId } from '../../../types/cash'
import { useActorName, useCaja } from '../hooks/useCaja'

interface TransferSheetProps {
  open: boolean
  onClose: () => void
  from?: CajaId
}

/** Moves cash between the two cajas — usually Menor → Mayor at the end of the day. */
export function TransferSheet({ open, onClose, from = 'menor' }: TransferSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[420px]">
      <TransferForm onClose={onClose} initialFrom={from} />
    </BottomSheet>
  )
}

function TransferForm({ onClose, initialFrom }: { onClose: () => void; initialFrom: CajaId }) {
  const { menor, mayor } = useCaja()
  const actor = useActorName()
  const [from, setFrom] = useState<CajaId>(initialFrom)
  const [amount, setAmount] = useState(0)
  const [busy, setBusy] = useState(false)

  const to: CajaId = from === 'menor' ? 'mayor' : 'menor'
  const balances = { menor, mayor }
  const insufficient = amount > balances[from] + 0.005

  async function submit() {
    if (!(amount > 0)) {
      toast('Escribe el monto a trasladar', 'orange')
      return
    }
    setBusy(true)
    try {
      await transferFunds({ from, to, amount, by: actor })
      toast(`${formatMoney(amount)} trasladados a ${CAJA_LABEL[to]}`, 'green')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-1 font-display text-[18px] font-bold">Trasladar fondos</div>
      <div className="mb-4 text-[12px] text-muted">Descuenta de una caja y suma a la otra al instante.</div>

      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1 rounded-xl bg-s2 px-3 py-2.5 text-center">
          <div className="field-label">Sale de</div>
          <div className="text-[13px] font-bold">{CAJA_LABEL[from]}</div>
          <div className="font-mono text-[12px] text-txt2">{formatMoney(balances[from])}</div>
        </div>
        <button onClick={() => setFrom(to)} title="Invertir sentido" aria-label="Invertir sentido" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-br2 text-txt2 hover:bg-s2">
          <ArrowRight size={16} />
        </button>
        <div className="flex-1 rounded-xl bg-s2 px-3 py-2.5 text-center">
          <div className="field-label">Entra a</div>
          <div className="text-[13px] font-bold">{CAJA_LABEL[to]}</div>
          <div className="font-mono text-[12px] text-txt2">{formatMoney(balances[to])}</div>
        </div>
      </div>

      <label className="mb-1 block field-label">Monto a trasladar *</label>
      <MoneyInput className="input mb-1.5 text-right font-mono text-[20px] font-bold" value={amount} onChange={(v) => setAmount(v ?? 0)} autoFocus />
      <button onClick={() => setAmount(balances[from])} className="mb-3 text-[12px] font-semibold text-lime">
        Trasladar todo ({formatMoney(balances[from])})
      </button>
      {amount > 0 && !insufficient && (
        <div className="mb-3 rounded-lg bg-s2 px-3 py-2 text-[12px] text-txt2">
          Quedarán: {CAJA_LABEL[from]} {formatMoney(round2(balances[from] - amount))} · {CAJA_LABEL[to]} {formatMoney(round2(balances[to] + amount))}
        </div>
      )}
      {insufficient && <div className="mb-3 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">Saldo insuficiente en {CAJA_LABEL[from]}.</div>}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy || insufficient} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-50">
          Trasladar
        </button>
      </div>
    </>
  )
}
