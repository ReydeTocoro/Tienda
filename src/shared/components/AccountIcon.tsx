import bancolombia from '../../assets/banks/bancolombia.png'
import nequi from '../../assets/banks/nequi.png'
import { ACCOUNT_LABEL, type TransferAccount } from '../lib/transferAccounts'

const ICON: Record<TransferAccount, string> = { nequi, bancolombia }

/** The entity's own mark (the icon its website uses), on a white tile so it reads in both themes — Nequi's letter is
 * dark purple and Bancolombia's is black. */
export function AccountIcon({ account, size = 28 }: { account: TransferAccount; size?: number }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-br2" style={{ width: size, height: size }}>
      <img src={ICON[account]} alt={ACCOUNT_LABEL[account]} title={ACCOUNT_LABEL[account]} draggable={false} className="block h-full w-full object-contain p-[2px]" />
    </span>
  )
}
