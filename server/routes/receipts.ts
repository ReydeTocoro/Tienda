import { Router } from 'express'
import type { Db } from '../db'
import { authOf } from '../auth'
import { assertSaleId } from '../domain/sales'
import { receiptOfSale, shareReceipt, sharedReceipt } from '../domain/receipts'
import { receiptEmail } from '../domain/receiptEmail'
import type { Mailer } from '../mailer'
import { HttpError, handle } from './http'

/** Reads of the open receipt route allowed per minute, for everybody together: a store's customers open
 * a handful a day. It exists so a stranger flooding the route can't use up the few database connections
 * the till shares with it. shortcut: one ceiling for every caller (the proxy chain in front of the
 * Function isn't known, so a client IP can't be trusted), upgrade to a per-IP limit once it is. */
const PUBLIC_READS_PER_MINUTE = 60

/** The page behind a WhatsApp link reads its receipt from here, with no sign-in: the 128-bit code in
 * the URL is the key. It's mounted before the API's auth (server/app.ts) and answers for one
 * receipt at a time — there is no listing. */
export function publicReceiptRouter(db: Db) {
  const router = Router()
  let windowStart = 0
  let reads = 0

  // A receipt is private: neither a search engine nor a referrer should carry its link anywhere.
  router.use((_req, res, next) => {
    res.set({ 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' })
    next()
  })
  router.get(
    '/:id',
    handle(async (req) => {
      const now = Date.now()
      if (now - windowStart >= 60_000) {
        windowStart = now
        reads = 0
      }
      if (++reads > PUBLIC_READS_PER_MINUTE) throw new HttpError(429, 'Hay muchas consultas en este momento: inténtalo de nuevo en un minuto')
      try {
        return await sharedReceipt(db, req.params.id)
      } catch (err) {
        if (err instanceof HttpError) throw err
        // Anyone can reach this route: a database error (it names hosts and ports) stays in our logs.
        console.error('No se pudo leer un recibo compartido:', err)
        throw new HttpError(503, 'No se pudo cargar el recibo. Inténtalo de nuevo en un momento')
      }
    }),
  )

  return router
}

/** An e-mail can go to any address from the store's Gmail, so each signed-in account gets this many an
 * hour (kept in memory: with two Function instances the real ceiling is twice that, which still stops a
 * runaway screen or a stolen session from spamming from the store's address). */
const EMAILS_PER_HOUR = 40
const HOUR = 3_600_000

/** What the API accepts as the PDF: base64 of a real PDF (it starts with "%PDF-") that is a few KB, not
 * a file in disguise. A receipt weighs about 5 KB, so more than ~1 MB is not a receipt. */
export function pdfAttachment(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || raw.length < 100 || raw.length > 1.4 * 1024 * 1024) return null
  const bytes = Buffer.from(raw, 'base64')
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-' ? bytes : null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Sharing a receipt, mounted at /api/recibos. Whoever is signed in at the store may do it — the receipt
 * carries nothing a cashier doesn't already hand over on paper — and the data always comes from the
 * saved sale, never from the request. */
export function receiptsRouter(db: Db, mailer: Mailer) {
  const router = Router()
  const sent = new Map<string, number[]>()

  /** The link for WhatsApp: the code of this sale's receipt (a new one, or the same refreshed). */
  router.post(
    '/compartir',
    handle(async (req) => {
      const who = authOf(req).email
      const { saleId } = (req.body ?? {}) as { saleId?: unknown }
      const id = assertSaleId(saleId)
      const link = await shareReceipt(db, id)
      console.info(`Recibo #${id} compartido por WhatsApp (${who})`)
      return link
    }, 201),
  )

  router.post(
    '/correo',
    handle(async (req) => {
      const who = authOf(req).email
      if (!mailer.enabled) throw new HttpError(503, 'El envío de correos no está configurado en el servidor')
      const { saleId, to, pdfBase64 } = (req.body ?? {}) as { saleId?: unknown; to?: unknown; pdfBase64?: unknown }
      const id = assertSaleId(saleId)
      const address = typeof to === 'string' ? to.trim() : ''
      if (address.length > 254 || !EMAIL.test(address)) throw new HttpError(400, 'Ese correo no parece válido')

      const now = Date.now()
      const recent = (sent.get(who) ?? []).filter((t) => now - t < HOUR)
      if (recent.length >= EMAILS_PER_HOUR) throw new HttpError(429, 'Se enviaron demasiados recibos por correo en la última hora. Inténtalo más tarde.')

      // Read first, send after: the SMTP conversation must not hold a database connection.
      const receipt = await receiptOfSale(db, id)
      const { subject, html, text } = receiptEmail(receipt)
      const pdf = pdfAttachment(pdfBase64)
      await mailer.send({
        to: address,
        fromName: receipt.storeName,
        subject,
        html,
        text,
        // The receipt is in the body too, so a PDF the browser couldn't make only costs the attachment.
        attachments: pdf ? [{ filename: `Recibo-${receipt.number.replace(/\D/g, '').padStart(4, '0')}.pdf`, content: pdf, contentType: 'application/pdf' }] : [],
      })
      sent.set(who, [...recent, now])
      console.info(`Recibo #${id} enviado por correo (${who} → ${address.replace(/^(.{2}).*(@.*)$/, '$1***$2')})`)
      return { ok: true }
    }),
  )

  return router
}
