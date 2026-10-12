import { formatMoney } from '../lib/currency'
import { receiptQty } from '../lib/receipt'

interface ReceiptLine {
  name: string
  qty: number
  unit: string
  price: number
  discount?: number
  isFree?: boolean
}

/** Where each look of a receipt gets its colors: the one on the till's screen (theme tokens), the printed slip (plain black
 * on white) and the page a customer opens from WhatsApp. */
const TONE = {
  screen: { rule: 'border-br2', muted: 'text-muted', discount: 'text-green' },
  print: { rule: 'border-black', muted: '', discount: '' },
  public: { rule: 'border-neutral-400', muted: 'text-neutral-600', discount: 'text-neutral-600' },
} as const

/** The products of a receipt as a small table: quantity | description | price of one unit | value of the line. The quantities
 * stand in one column, right aligned (so the digits line up), the description takes what is left and wraps when a name is long,
 * and the two figures stand in columns of their own on the right. One grid for all the rows, so the columns are as wide as their
 * widest cell. */
export function ReceiptItems({ items, tone }: { items: ReceiptLine[]; tone: keyof typeof TONE }) {
  const t = TONE[tone]
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-2 gap-y-[3px]">
      <span className={`border-b border-dashed pb-0.5 text-right text-[10px] font-bold ${t.rule}`}>CANT.</span>
      <span className={`border-b border-dashed pb-0.5 text-[10px] font-bold ${t.rule}`}>DESCRIPCIÓN</span>
      <span className={`border-b border-dashed pb-0.5 text-right text-[10px] font-bold ${t.rule}`}>P. UNIT.</span>
      <span className={`border-b border-dashed pb-0.5 text-right text-[10px] font-bold ${t.rule}`}>VALOR</span>
      {items.map((i, k) => (
        <ItemRow key={k} item={i} discountClass={t.discount} mutedClass={t.muted} />
      ))}
    </div>
  )
}

function ItemRow({ item: i, discountClass, mutedClass }: { item: ReceiptLine; discountClass: string; mutedClass: string }) {
  return (
    <>
      <span className="whitespace-nowrap text-right font-bold">{receiptQty(i, '')}</span>
      <span className="min-w-0 break-words">
        {i.name}
        {i.isFree ? ' [Libre]' : ''}
        {i.discount ? <span className={`block text-[0.92em] ${discountClass}`}>Desc. −{formatMoney(i.discount)}</span> : null}
      </span>
      <span className={`whitespace-nowrap text-right ${mutedClass}`}>{formatMoney(i.price)}</span>
      <span className="whitespace-nowrap text-right font-semibold">{formatMoney(i.price * i.qty)}</span>
    </>
  )
}
