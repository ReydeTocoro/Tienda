import type { BusinessInfo } from '../../types/settings'
import type { PayMethod, Sale } from '../../types/sale'
import { businessLines, receiptFooter } from './business'
import { formatDateTime, formatMoney, formatQty } from './currency'
import { formatSaleId, isPendingSaleId } from './id'
import { ACCOUNT_LABEL, type TransferAccount } from './transferAccounts'
import { isMeasuredUnit, unitShortLabel } from './units'

/** One line of a receipt: what was sold, as the customer reads it. */
export interface ReceiptItem {
  name: string
  qty: number
  unit: string
  /** Unit price. */
  price: number
  /** Money taken off this line (a discount on this product). */
  discount?: number
  /** A free-form line (the `CORR` line of a sale correction, or one made before "producto libre" was removed). */
  isFree?: boolean
}

/** Everything a receipt shows — and nothing more: no cost, no profit, no notes. The same data feeds the
 * thermal text, the PDF, the e-mail and the page behind a WhatsApp link, so the four never disagree.
 * It is also what the API stores for a shared link (server/domain/receipts.ts). */
export interface ReceiptData {
  /** The sale's number as printed, "#0007" ("PEND-0003" while it is a provisional receipt). */
  number: string
  /** Made without internet and not yet on the server: the number is provisional and the receipt says so. */
  provisional?: boolean
  /** ISO date of the sale. */
  date: string
  storeName: string
  business?: BusinessInfo
  /** Who served the customer. */
  sellerName?: string
  customerName?: string
  /** The name a fiado was written under — only for a sale without a customer. */
  fiadoName?: string
  items: ReceiptItem[]
  subtotal: number
  discount: number
  roundingAdjustment?: number
  total: number
  payMethod: PayMethod
  /** For a transfer: the account it came into. */
  transferAccount?: TransferAccount
  amountReceived?: number
  changeGiven?: number
}

export function receiptFromSale(sale: Sale, storeName: string, business?: BusinessInfo): ReceiptData {
  return {
    number: formatSaleId(sale.id),
    ...(isPendingSaleId(sale.id) ? { provisional: true } : {}),
    date: sale.date,
    storeName,
    business,
    sellerName: sale.sellerName || undefined,
    customerName: sale.customerName || undefined,
    fiadoName: sale.fiadoName && !sale.customerId ? sale.fiadoName : undefined,
    items: sale.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, price: i.price, ...(i.discount ? { discount: i.discount } : {}), ...(i.isFree ? { isFree: true } : {}) })),
    subtotal: sale.subtotal ?? sale.total,
    discount: sale.discount || 0,
    roundingAdjustment: sale.roundingAdjustment || undefined,
    total: sale.total,
    payMethod: sale.payMethod,
    ...(sale.payMethod === 'transferencia' && sale.transferAccount ? { transferAccount: sale.transferAccount } : {}),
    amountReceived: sale.amountReceived,
    changeGiven: sale.changeGiven,
  }
}

/** "efectivo" → "Efectivo"; a transfer says its account: "Transferencia · Nequi". */
export const payMethodLabel = (m: string, account?: TransferAccount): string => m.charAt(0).toUpperCase() + m.slice(1) + (account ? ` · ${ACCOUNT_LABEL[account]}` : '')

/** A line's quantity as the receipt writes it: "x3", or "1,5kg" for what is sold by weight or measure. */
export function receiptQty(i: Pick<ReceiptItem, 'qty' | 'unit'>, prefix = 'x'): string {
  return isMeasuredUnit(i.unit) ? `${formatQty(i.qty)}${unitShortLabel(i.unit)}` : `${prefix}${formatQty(i.qty)}`
}

/** How many characters wide the monospaced text of a receipt is: what an 80 mm roll prints in a small font (the PDF draws it at
 * 7.5 pt Courier, which is exactly this wide on the roll). */
export const RECEIPT_COLS = 45

const padLeft = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const padRight = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const centered = (s: string) => (s.length >= RECEIPT_COLS ? s : ' '.repeat(Math.floor((RECEIPT_COLS - s.length) / 2)) + s)
/** A label on the left and its figure flush right, on one line. */
const spread = (left: string, right: string) => left + ' '.repeat(Math.max(1, RECEIPT_COLS - left.length - right.length)) + right

/** A text cut into lines of at most `width`, at the spaces where it can (a word longer than the line is cut). */
function wrapText(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word
    while (rest.length > width) {
      if (line) out.push(line)
      line = ''
      out.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (!line) line = rest
    else if (line.length + 1 + rest.length <= width) line += ' ' + rest
    else {
      out.push(line)
      line = rest
    }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

/** The products as four columns — CANT | DESCRIPCIÓN | P.UNIT | VALOR: the quantities stand one under another (right aligned),
 * then the price of one unit and the value of the line, both flush right, and a long name goes down to the next line inside its
 * own column. */
function itemRows(items: ReceiptItem[]): string[] {
  const qtys = items.map((i) => receiptQty(i, ''))
  const units = items.map((i) => formatMoney(i.price))
  const prices = items.map((i) => formatMoney(i.price * i.qty))
  const qtyW = Math.min(8, Math.max(4, ...qtys.map((q) => q.length)))
  const unitW = Math.min(13, Math.max(6, ...units.map((u) => u.length)))
  const priceW = Math.min(14, Math.max(5, ...prices.map((p) => p.length)))
  const nameW = Math.max(12, RECEIPT_COLS - qtyW - unitW - priceW - 3)
  const rows = [`${padLeft('CANT', qtyW)} ${padRight('DESCRIPCIÓN', nameW)} ${padLeft('P.UNIT', unitW)} ${padLeft('VALOR', priceW)}`]
  items.forEach((i, k) => {
    wrapText(`${i.name}${i.isFree ? ' [Libre]' : ''}`, nameW).forEach((part, n) => {
      rows.push(`${n === 0 ? padLeft(qtys[k], qtyW) : ' '.repeat(qtyW)} ${padRight(part, nameW)} ${n === 0 ? padLeft(units[k], unitW) : ' '.repeat(unitW)} ${n === 0 ? padLeft(prices[k], priceW) : ''}`)
    })
    if (i.discount) rows.push(`${' '.repeat(qtyW)} ${padRight('  Desc.', nameW)} ${' '.repeat(unitW)} ${padLeft('-' + formatMoney(i.discount), priceW)}`)
  })
  return rows.map((l) => l.trimEnd())
}

/** The receipt in plain text, laid out for a monospaced 80 mm roll (`RECEIPT_COLS` wide) — what "Copiar texto" copies, what
 * the PDF draws, and what goes over WhatsApp when the link can't be made. */
export function receiptText(r: ReceiptData): string {
  const rule = '-'.repeat(RECEIPT_COLS)
  const lines: string[] = [
    ...[r.storeName.toUpperCase(), ...businessLines(r.business)].map(centered),
    rule,
    centered(`${r.provisional ? 'RECIBO PROVISIONAL' : 'RECIBO DE VENTA'} ${r.number}`),
    centered(formatDateTime(r.date)),
    ...(r.sellerName ? [centered('Atendió: ' + r.sellerName)] : []),
    ...(r.customerName ? [centered(r.customerName)] : []),
    ...(r.fiadoName ? [centered('Fiado: ' + r.fiadoName)] : []),
    rule,
    ...itemRows(r.items),
    rule,
    spread('Subtotal', formatMoney(r.subtotal)),
    ...(r.discount ? [spread('Descuento', '-' + formatMoney(r.discount))] : []),
    ...(r.roundingAdjustment ? [spread('Ajuste', (r.roundingAdjustment > 0 ? '+' : '') + formatMoney(r.roundingAdjustment))] : []),
    spread('TOTAL', formatMoney(r.total)),
    rule,
    spread('Pago', payMethodLabel(r.payMethod, r.transferAccount)),
    ...(r.amountReceived !== undefined ? [spread('Recibido', formatMoney(r.amountReceived))] : []),
    ...(r.changeGiven !== undefined ? [spread('Cambio', formatMoney(r.changeGiven))] : []),
    rule,
    ...receiptFooter(r.business).split('\n').map(centered),
  ]
  return lines.join('\n')
}
