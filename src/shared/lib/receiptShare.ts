import { formatMoney } from './currency'
import { receiptFooter } from './business'
import type { ReceiptData } from './receipt'

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** The number WhatsApp's `wa.me` link wants: digits only, with the country code. A Colombian mobile
 * (10 digits, starting with 3) gets 57 in front; one that already carries a country code, or comes
 * from another country (11 to 15 digits), is kept as it is. A landline or a half-typed number can't
 * be messaged on WhatsApp, so it gives `null`. */
export function whatsappNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  if (digits.length === 10 && digits.startsWith('3')) return '57' + digits
  if (digits.length >= 11 && digits.length <= 15) return digits
  return null
}

/** The message that opens in the customer's chat: the store, the number and total, and the link
 * where they see the receipt and download the PDF. */
export function whatsappMessage(r: ReceiptData, link: string): string {
  return [
    `*${r.storeName}*`,
    `Recibo ${r.number} · Total: ${formatMoney(r.total)}`,
    '',
    'Ver y descargar tu recibo (PDF):',
    link,
    '',
    receiptFooter(r.business),
  ].join('\n')
}

/** `wa.me` URL that opens a chat with `number` and the message already typed (the cashier presses send). */
export const whatsappUrl = (number: string, message: string): string => `https://wa.me/${number}?text=${encodeURIComponent(message)}`
