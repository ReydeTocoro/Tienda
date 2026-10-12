import { businessLines, receiptFooter } from '../../src/shared/lib/business'
import { formatMoney, formatQty } from '../../src/shared/lib/currency'
import { payMethodLabel, receiptQty, type ReceiptData } from '../../src/shared/lib/receipt'
import { isMeasuredUnit, unitShortLabel } from '../../src/shared/lib/units'

const STORE_TIMEZONE = 'America/Bogota'

const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Everything that reaches the HTML goes through this: a product named `<b>` or `&` can't break the mail
 * or inject markup. */
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => escapes[c])

const dateOf = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('es-CO', { timeZone: STORE_TIMEZONE, dateStyle: 'short', timeStyle: 'short' })
}

export interface ReceiptEmail {
  subject: string
  html: string
  text: string
}

/** The receipt as the body of an e-mail (the PDF travels attached): an HTML table that reads on any
 * phone without opening anything, and a plain-text twin. Brand colors are inline because mail clients
 * ignore stylesheets and CSS variables. */
export function receiptEmail(r: ReceiptData): ReceiptEmail {
  const items = r.items.slice(0, 200)
  const lines = (label: string, value: string, extra = '') =>
    `<tr><td style="padding:3px 0;${extra}">${label}</td><td style="padding:3px 0;text-align:right;${extra}">${value}</td></tr>`
  const who = r.customerName || r.fiadoName

  const rows = items
    .map((i) => {
      const per = isMeasuredUnit(i.unit) ? `/${unitShortLabel(i.unit)}` : ' c/u'
      return `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #e3e8f0">${esc(isMeasuredUnit(i.unit) ? receiptQty(i) : `${formatQty(i.qty)} ×`)} ${esc(i.name)}<br>
        <span style="color:#6b7487;font-size:12px">${esc(formatMoney(i.price))}${per}</span>${i.discount ? `<br><span style="color:#2e7d32;font-size:12px">Descuento −${esc(formatMoney(i.discount))}</span>` : ''}</td>
      <td style="padding:6px 0;border-bottom:1px solid #e3e8f0;text-align:right;white-space:nowrap">${esc(formatMoney(i.price * i.qty))}</td>
    </tr>`
    })
    .join('')

  const cash = r.payMethod === 'efectivo' && r.amountReceived !== undefined
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172033;max-width:480px;margin:auto;padding:16px">
      <h2 style="margin:0 0 4px;color:#003d98">${esc(r.storeName)}</h2>
      ${businessLines(r.business)
        .map((l) => `<div style="color:#6b7487;font-size:13px">${esc(l)}</div>`)
        .join('')}
      <p style="margin:16px 0 4px;font-size:14px"><strong>Recibo de venta ${esc(r.number)}</strong><br>
        ${esc(dateOf(r.date))}${who ? `<br>Cliente: ${esc(who)}` : ''}<br>Pago: ${esc(payMethodLabel(r.payMethod, r.transferAccount))}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">${rows}</table>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">
        ${r.discount > 0 ? lines('Subtotal', esc(formatMoney(r.subtotal))) + lines('Descuento', '−' + esc(formatMoney(r.discount))) : ''}
        ${r.roundingAdjustment ? lines('Ajuste', (r.roundingAdjustment > 0 ? '+' : '−') + esc(formatMoney(Math.abs(r.roundingAdjustment)))) : ''}
        ${lines('TOTAL', esc(formatMoney(r.total)), 'font-weight:bold;font-size:16px')}
        ${cash ? lines('Efectivo recibido', esc(formatMoney(r.amountReceived))) + (r.changeGiven !== undefined ? lines('Cambio', esc(formatMoney(r.changeGiven))) : '') : ''}
      </table>
      <p style="margin-top:20px;text-align:center;color:#4a5468;font-size:13px">${esc(receiptFooter(r.business))}</p>
    </div>`

  const text = [
    r.storeName,
    ...businessLines(r.business),
    '',
    `Recibo de venta ${r.number}`,
    dateOf(r.date),
    ...(who ? [`Cliente: ${who}`] : []),
    `Pago: ${payMethodLabel(r.payMethod, r.transferAccount)}`,
    '',
    ...items.map((i) => `• ${receiptQty(i, '')}${isMeasuredUnit(i.unit) ? '' : ' x'} ${i.name} — ${formatMoney(i.price * i.qty)}${i.discount ? ` (descuento -${formatMoney(i.discount)})` : ''}`),
    '',
    ...(r.discount > 0 ? [`Descuento: -${formatMoney(r.discount)}`] : []),
    `TOTAL: ${formatMoney(r.total)}`,
    '',
    receiptFooter(r.business),
  ].join('\n')

  return { subject: `Recibo de venta ${r.number} — ${r.storeName}`, html, text }
}
