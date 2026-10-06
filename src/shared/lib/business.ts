import type { BusinessInfo } from '../../types/settings'

export const DEFAULT_RECEIPT_FOOTER = '¡Gracias por su compra!'

/** The closing line of a receipt: the store's own message, or the classic one. */
export function receiptFooter(b?: BusinessInfo): string {
  return b?.receiptFooter?.trim() || DEFAULT_RECEIPT_FOOTER
}

/** The lines printed under the store name — only the ones filled in, in this order. */
export function businessLines(b?: BusinessInfo): string[] {
  return [b?.nit?.trim() && `NIT: ${b.nit.trim()}`, b?.phone?.trim() && `Tel: ${b.phone.trim()}`, b?.address?.trim()].filter((l): l is string => !!l)
}
