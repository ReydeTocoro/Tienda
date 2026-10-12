import { AccountIcon } from './AccountIcon'
import { ACCOUNT_HINT, ACCOUNT_LABEL, TRANSFER_ACCOUNTS, type TransferAccount } from '../lib/transferAccounts'

/** "¿A qué cuenta llegó?": one big button per account, each with its entity's own icon. Nothing is chosen until the
 * person picks — a transfer is never charged to an account by default. */
export function AccountPicker({ value, onChange }: { value: TransferAccount | null; onChange: (a: TransferAccount) => void }) {
  return (
    <div role="radiogroup" aria-label="Cuenta a la que llegó la transferencia" className="grid grid-cols-2 gap-2">
      {TRANSFER_ACCOUNTS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          onClick={() => onChange(a)}
          className={`flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${
            value === a ? 'border-lime bg-lime/15' : 'border-br bg-s1 hover:border-br2 hover:bg-s2'
          }`}
        >
          <AccountIcon account={a} size={34} />
          <span className="min-w-0">
            <span className={`block text-[13px] font-bold ${value === a ? 'text-lime' : 'text-txt'}`}>{ACCOUNT_LABEL[a]}</span>
            {ACCOUNT_HINT[a] && <span className="block truncate text-[10px] text-muted">{ACCOUNT_HINT[a]}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
