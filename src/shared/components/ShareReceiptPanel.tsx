import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Send } from 'lucide-react'
import { db } from '../../db/index'
import { emailReceipt, shareReceipt } from '../../db/repositories/receipts'
import { toast } from '../../store/useToastStore'
import { receiptText, type ReceiptData } from '../lib/receipt'
import { blobToBase64, buildReceiptPdfBlob } from '../lib/receiptPdf'
import { EMAIL_PATTERN, whatsappMessage, whatsappNumber, whatsappUrl } from '../lib/receiptShare'

export type ShareChannel = 'correo' | 'whatsapp'

interface ShareReceiptPanelProps {
  channel: ShareChannel
  saleId: number
  /** The sale's customer, if it has one: their e-mail or phone is filled in (it can be typed over). */
  customerId?: string
  receipt: ReceiptData
  /** Close the panel — after sending, or with the arrow. */
  onDone: () => void
}

/** The one-row panel under the receipt: where to send it, and Enviar. By e-mail the server sends it from
 * the store's Gmail (the PDF made here goes attached); by WhatsApp it opens the customer's chat with a link
 * to the receipt already typed — the cashier only presses send, nothing leaves on its own. */
export function ShareReceiptPanel({ channel, saleId, customerId, receipt, onDone }: ShareReceiptPanelProps) {
  const byMail = channel === 'correo'
  const customer = useLiveQuery(() => (customerId ? db.customers.get(customerId) : undefined), [customerId])
  // Until the cashier types, the field shows the customer's own e-mail or phone.
  const [typed, setTyped] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const known = (byMail ? customer?.email : customer?.phone)?.trim()
  const value = typed ?? known ?? ''

  async function sendMail() {
    const to = value.trim()
    if (!EMAIL_PATTERN.test(to)) return toast('Ese correo no parece válido', 'red')
    setBusy(true)
    try {
      // The PDF is a nice-to-have: the e-mail's body already carries the whole receipt.
      const pdf = await buildReceiptPdfBlob(receipt).then(blobToBase64, () => undefined)
      await emailReceipt(saleId, to, pdf)
      toast('Recibo enviado a ' + to, 'lime')
      onDone()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo enviar el correo', 'red')
      setBusy(false)
    }
  }

  async function sendWhatsapp() {
    const number = whatsappNumber(value)
    if (!number) return toast('Escribe el celular completo (10 dígitos, ej. 300 123 4567)', 'red')
    // The tab opens first, inside the click: after an `await` the browser would block it as a pop-up.
    const tab = window.open('', '_blank')
    if (!tab) return toast('Habilita las ventanas emergentes para abrir WhatsApp', 'orange')
    tab.opener = null
    setBusy(true)
    let message: string
    try {
      message = whatsappMessage(receipt, (await shareReceipt(saleId)).link)
    } catch (e) {
      // No link (offline, server down): the receipt goes as plain text, which always works.
      toast(`No se pudo crear el enlace del recibo (${e instanceof Error ? e.message : 'error'}). Se envía el recibo en texto`, 'orange')
      message = receiptText(receipt)
    }
    tab.location.href = whatsappUrl(number, message)
    onDone()
  }

  return (
    <div className="mt-2">
      <label htmlFor="receipt-destination" className="mb-1 block field-label">
        {byMail ? 'Correo para enviar el recibo' : 'Celular (WhatsApp) para enviar el recibo'}
        {typed === null && known && customer ? <span className="font-normal normal-case"> · de {customer.name}</span> : null}
      </label>
      <div className="flex gap-2">
        <input
          id="receipt-destination"
          autoFocus
          type={byMail ? 'email' : 'tel'}
          inputMode={byMail ? 'email' : 'tel'}
          autoComplete="off"
          value={value}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={byMail ? 'cliente@correo.com' : '300 123 4567'}
          className="input min-w-0 flex-1"
        />
        <button
          data-enter
          onClick={() => void (byMail ? sendMail() : sendWhatsapp())}
          disabled={busy}
          className="flex flex-shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-lime px-3.5 text-[13px] font-semibold text-on-solid disabled:opacity-60"
        >
          <Send size={14} />
          {busy ? 'Enviando…' : 'Enviar'}
        </button>
        <button onClick={onDone} disabled={busy} aria-label="Volver" className="flex-shrink-0 rounded-[10px] border border-br2 px-3 text-txt2 disabled:opacity-60">
          <ArrowLeft size={16} />
        </button>
      </div>
    </div>
  )
}
