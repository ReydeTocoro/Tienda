import { publicOrigin } from '../../api/base'
import { apiPost } from '../../api/client'

/** Where the page behind a WhatsApp link opens: this same site, so it works on whichever address the
 * store uses (the Hosting domain today) — in an installed app, the public address it was built with. */
export const receiptLinkOf = (code: string): string => `${publicOrigin()}/recibo/${code}`

/** Asks the server for the link of a sale's receipt. The server stores the receipt (taken from the saved
 * sale, never from this browser) under a random 128-bit code and returns the code. */
export async function shareReceipt(saleId: number): Promise<{ link: string; expiresAt: string }> {
  const { id, expiresAt } = await apiPost<{ id: string; expiresAt: string }>('/api/recibos/compartir', { saleId })
  return { link: receiptLinkOf(id), expiresAt }
}

/** E-mails a sale's receipt through the store's Gmail. The server builds the message from the saved sale;
 * `pdfBase64` (optional) is the PDF this browser made, sent along as an attachment. */
export async function emailReceipt(saleId: number, to: string, pdfBase64?: string): Promise<void> {
  await apiPost('/api/recibos/correo', { saleId, to, pdfBase64 })
}
