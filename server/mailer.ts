import nodemailer from 'nodemailer'
import { HttpError } from './routes/http'

export interface MailMessage {
  to: string
  /** The name the recipient sees next to the store's address (the address itself is always the account's). */
  fromName: string
  subject: string
  text: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>
}

/** Sends the store's e-mails (today: receipts). Injected into `createApp`, like `Accounts`, so the
 * self-checks can swap in one that sends nothing. */
export interface Mailer {
  /** False when the server has no mail account set up: the routes answer 503 instead of failing later. */
  enabled: boolean
  send(message: MailMessage): Promise<void>
}

export const noMailer: Mailer = {
  enabled: false,
  async send() {
    throw new HttpError(503, 'El envío de correos no está configurado en el servidor')
  },
}

export interface GmailConfig {
  /** The Gmail account every e-mail leaves from. */
  user: string
  /** Its app password (the account needs 2-step verification) — a secret: `.env.local` locally, a
   * Secret Manager secret in the Function. Never the account's own password. */
  password: string
}

/** Sends through Gmail's SMTP with an app password. The sender address has to be the authenticated
 * account itself: with any other, Gmail rewrites the header or the mail lands in spam — so only the
 * name is ever chosen per message. */
export function gmailMailer({ user, password }: GmailConfig): Mailer {
  // Google shows an app password as four groups of letters separated by spaces; the spaces aren't part of it.
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass: password.replace(/\s+/g, '') } })
  return {
    enabled: true,
    async send({ fromName, ...message }) {
      try {
        await transport.sendMail({ ...message, from: { name: fromName.replace(/[\r\n"<>]/g, '').trim() || user, address: user } })
      } catch (err) {
        console.error('No se pudo enviar el correo:', err)
        const code = (err as { code?: string }).code
        if (code === 'EAUTH') throw new HttpError(502, 'El correo de la tienda no está bien configurado (contraseña de aplicación de Gmail)')
        throw new HttpError(502, 'No se pudo enviar el correo. Revisa la dirección e inténtalo de nuevo')
      }
    },
  }
}
