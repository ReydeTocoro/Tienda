import { apiUrl } from '../../api/base'
import type { ReceiptData } from '../../shared/lib/receipt'

/** A refused read of a shared receipt, with the status (404 no such receipt, 410 the link expired, 0 no
 * connection) and the server's own message. */
export class SharedReceiptError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** What the public page behind a WhatsApp link reads — with a plain `fetch`, no sign-in and none of the
 * app's session code: a customer opening the link has no account here. */
export async function fetchSharedReceipt(code: string): Promise<ReceiptData> {
  let res: Response
  try {
    res = await fetch(apiUrl(`/api/recibo/${encodeURIComponent(code)}`))
  } catch {
    throw new SharedReceiptError(0, 'Sin conexión: revisa tu internet e inténtalo de nuevo.')
  }
  const body = (await res.json().catch(() => ({}))) as { receipt?: ReceiptData; error?: string }
  if (!res.ok || !body.receipt) throw new SharedReceiptError(res.status, body.error || 'No encontramos este recibo')
  return body.receipt
}
