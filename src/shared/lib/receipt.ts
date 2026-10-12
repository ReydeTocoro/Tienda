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

/** The receipt in plain text, laid out for a monospaced 80 mm roll — what "Copiar texto" copies, what
 * the PDF draws, and what goes over WhatsApp when the link can't be made. */
export function receiptText(r: ReceiptData): string {
  const itemLines = r.items.map((i) => `  ${i.name}${i.isFree ? ' [Libre]' : ''} ${receiptQty(i)}  $${formatMoney(i.price * i.qty).slice(1)}${i.discount ? `\n    Desc. -${formatMoney(i.discount)}` : ''}`).join('\n')

  return `${[r.storeName.toUpperCase(), ...businessLines(r.business)].join('\n')}
━━━━━━━━━━━━━━━━━━━━
${r.provisional ? 'RECIBO PROVISIONAL' : 'RECIBO DE VENTA'} ${r.number}
${formatDateTime(r.date)}${r.sellerName ? '\nAtendió: ' + r.sellerName : ''}${r.customerName ? '\n' + r.customerName : ''}${r.fiadoName ? '\nFiado: ' + r.fiadoName : ''}
━━━━━━━━━━━━━━━━━━━━
${itemLines}
━━━━━━━━━━━━━━━━━━━━
Subtotal: ${formatMoney(r.subtotal)}${r.discount ? '\nDescuento: -' + formatMoney(r.discount) : ''}${r.roundingAdjustment ? '\nAjuste: ' + (r.roundingAdjustment > 0 ? '+' : '') + formatMoney(r.roundingAdjustment) : ''}
TOTAL: ${formatMoney(r.total)}
Pago: ${payMethodLabel(r.payMethod, r.transferAccount)}${r.amountReceived !== undefined ? '\nRecibido: ' + formatMoney(r.amountReceived) : ''}${r.changeGiven !== undefined ? '\nCambio: ' + formatMoney(r.changeGiven) : ''}
━━━━━━━━━━━━━━━━━━━━
${receiptFooter(r.business)}`
}
