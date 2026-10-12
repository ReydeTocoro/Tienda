/** The accounts a bank transfer can land in. A transfer says which one when it is charged (or, for a fiado, when it is
 * collected), so the day's close can tell the store how much came into each — to check against each app. */
export const TRANSFER_ACCOUNTS = ['nequi', 'bancolombia'] as const
export type TransferAccount = (typeof TRANSFER_ACCOUNTS)[number]

export const ACCOUNT_LABEL: Record<TransferAccount, string> = { nequi: 'Nequi', bancolombia: 'Bancolombia' }

/** Ahorro a la Mano is an account of Bancolombia (same bank, same brand), so it goes under Bancolombia; the picker says so. */
export const ACCOUNT_HINT: Partial<Record<TransferAccount, string>> = { bancolombia: 'Ahorro a la Mano' }

export const isTransferAccount = (v: unknown): v is TransferAccount => typeof v === 'string' && (TRANSFER_ACCOUNTS as readonly string[]).includes(v)

/** How much came in by transfer into each account over a period ('sin': transfers that didn't say which — sales from
 * before the question existed, or from a screen that doesn't ask it). Signed: money handed back counts against it. */
export type TransferBreak = Record<TransferAccount | 'sin', number>

export const emptyTransferBreak = (): TransferBreak => ({ nequi: 0, bancolombia: 0, sin: 0 })

/** The accounts that moved money, in a fixed order, for the lists that show them. */
export function transferRows(b: TransferBreak | undefined): Array<{ key: keyof TransferBreak; label: string; value: number }> {
  if (!b) return []
  return ([...TRANSFER_ACCOUNTS, 'sin'] as const)
    .filter((k) => Math.abs(b[k] ?? 0) > 0.005)
    .map((k) => ({ key: k, label: k === 'sin' ? 'Sin cuenta indicada' : ACCOUNT_LABEL[k], value: b[k] }))
}
