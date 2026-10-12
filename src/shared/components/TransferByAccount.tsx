import { AccountIcon } from './AccountIcon'
import { formatMoney } from '../lib/currency'
import { transferRows, type TransferBreak } from '../lib/transferAccounts'

/** What came in by transfer, one line per account that moved money (nothing when none did). `plain` is for the printed
 * slip: black on white, no icons. */
export function TransferByAccount({ breakdown, plain = false }: { breakdown: TransferBreak | undefined; plain?: boolean }) {
  const rows = transferRows(breakdown)
  if (!rows.length) return null
  return (
    <>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            {!plain && r.key !== 'sin' && <AccountIcon account={r.key} size={18} />}
            {r.label}
          </span>
          <span className={plain ? '' : 'font-mono font-semibold'}>{formatMoney(r.value)}</span>
        </div>
      ))}
    </>
  )
}
