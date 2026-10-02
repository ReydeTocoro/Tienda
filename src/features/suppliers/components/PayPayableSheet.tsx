import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { MoneyInput } from '../../../shared/components/MoneyInput'
import { payPayable } from '../../../db/repositories/purchaseOrders'
import { CAJA_LABEL, formatDayKey, payableBalance } from '../../../shared/lib/cash'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { toast } from '../../../store/useToastStore'
import type { CajaId } from '../../../types/cash'
import type { Payable } from '../../../types/purchaseOrder'
import { useActorName, useCaja } from '../../cash/hooks/useCaja'

interface PayPayableSheetProps {
  payable: Payable | null
  onClose: () => void
}

/** Pay (all or part of) what is owed to a supplier. Comes out of the Caja Mayor by default. */
export function PayPayableSheet({ payable, onClose }: PayPayableSheetProps) {
  return (
    <BottomSheet open={!!payable} onClose={onClose} maxWidthClass="max-w-[460px]">
      {payable && <PayForm payable={payable} onClose={onClose} />}
    </BottomSheet>
  )
}

function PayForm({ payable, onClose }: { payable: Payable; onClose: () => void }) {
  const { menor, mayor } = useCaja()
  const actor = useActorName()
  const balance = payableBalance(payable)
  const [amount, setAmount] = useState(balance)
  const [caja, setCaja] = useState<CajaId>('mayor')
  const [busy, setBusy] = useState(false)

  const balances = { menor, mayor }
  const over = amount > balance + 0.001
  const insufficient = amount > balances[caja] + 0.005

  async function submit() {
    if (!(amount > 0)) {
      toast('Escribe el monto del pago', 'orange')
      return
    }
    setBusy(true)
    try {
      await payPayable(payable.id!, { amount, caja, by: actor })
      toast(`Pago de ${formatMoney(amount)} registrado`, 'green')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const choice = (is: boolean) => `flex-1 rounded-xl border-2 p-2.5 text-left transition-colors ${is ? 'border-lime bg-lime/10' : 'border-br2 hover:bg-s2'}`

  return (
    <>
      <div className="mb-0.5 font-display text-[18px] font-bold">Pagar a {payable.supplierName}</div>
      <div className="mb-3.5 text-[12px] text-muted">
        Pedido {formatOrderId(payable.orderId)} · vence {formatDayKey(payable.dueDate)}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <Mini label="Total" value={formatMoney(payable.amount)} />
        <Mini label="Pagado" value={formatMoney(payable.paid)} />
        <Mini label="Saldo" value={formatMoney(balance)} strong />
      </div>

      <label className="mb-1 block field-label">Monto a pagar *</label>
      <MoneyInput className="input mb-1.5 text-right font-mono text-[20px] font-bold" value={amount} onChange={(v) => setAmount(v ?? 0)} autoFocus />
      <div className="mb-3 flex gap-3 text-[12px] font-semibold text-lime">
        <button onClick={() => setAmount(balance)}>Todo el saldo</button>
        <button onClick={() => setAmount(Math.round((balance / 2) * 100) / 100)}>Mitad</button>
      </div>
      {over && <div className="mb-2 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">El pago supera el saldo pendiente.</div>}

      <div className="mb-1.5 field-label">Sale de</div>
      <div className="mb-2 flex gap-2">
        {(['mayor', 'menor'] as const).map((c) => (
          <button key={c} type="button" onClick={() => setCaja(c)} className={choice(caja === c)}>
            <div className="text-[13px] font-bold">{CAJA_LABEL[c]}</div>
            <div className={`font-mono text-[12px] ${balances[c] + 0.005 < amount ? 'text-red' : 'text-txt2'}`}>{formatMoney(balances[c])}</div>
          </button>
        ))}
      </div>
      {insufficient && !over && <div className="mb-2 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">{CAJA_LABEL[caja]} no tiene saldo suficiente.</div>}

      {payable.payments.length > 0 && (
        <div className="mb-3 mt-2 rounded-lg bg-s2 px-3 py-2 text-[11px] text-txt2">
          {payable.payments.map((p, i) => (
            <div key={i} className="flex justify-between py-0.5">
              <span>
                {formatDateTime(p.date)} · {CAJA_LABEL[p.caja]}
              </span>
              <span className="font-mono">{formatMoney(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy || over || insufficient} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-bg disabled:opacity-50">
          Registrar pago
        </button>
      </div>
    </>
  )
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-s2 px-2 py-2">
      <div className="field-label">{label}</div>
      <div className={`font-mono text-[13px] ${strong ? 'font-bold text-red' : 'font-semibold'}`}>{value}</div>
    </div>
  )
}
