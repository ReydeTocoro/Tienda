import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import { getSettings } from '../../db/repositories/settings'
import { BottomSheet } from './BottomSheet'
import { formatMoney, formatDateTime } from '../lib/currency'
import { formatSaleId } from '../lib/id'
import { unitShortLabel, isMeasuredUnit } from '../lib/units'
import { getPts } from '../lib/loyalty'
import { toast } from '../../store/useToastStore'

interface ReceiptSheetProps {
  sale: Sale | null
  onClose: () => void
  onCorrect?: () => void
}

const PAY_ICON: Record<string, string> = { efectivo: '💵', transferencia: '📲', fiado: '📋' }

function buildReceiptText(sale: Sale, storeName: string): string {
  const itemLines = sale.items
    .map((i) => {
      const ul = isMeasuredUnit(i.unit) ? unitShortLabel(i.unit) : null
      const qtyStr = ul ? `${i.qty}${ul}` : `x${i.qty}`
      return `  ${i.name}${i.isFree ? ' [Libre]' : ''} ${qtyStr}  $${formatMoney(i.price * i.qty).slice(1)}`
    })
    .join('\n')

  return `🏪 ${storeName.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━
RECIBO DE VENTA ${formatSaleId(sale.id)}
${formatDateTime(sale.date)}${sale.customerName ? '\n👤 ' + sale.customerName : ''}${sale.fiadoName && !sale.customerId ? '\n📋 Fiado: ' + sale.fiadoName : ''}
━━━━━━━━━━━━━━━━━━━━
${itemLines}
━━━━━━━━━━━━━━━━━━━━
Subtotal:  ${formatMoney(sale.subtotal ?? sale.total)}${sale.discount ? '\nDescuento: -' + formatMoney(sale.discount) : ''}${sale.roundingAdjustment ? '\nAjuste:    ' + (sale.roundingAdjustment > 0 ? '+' : '') + formatMoney(sale.roundingAdjustment) : ''}
TOTAL:     ${formatMoney(sale.total)}
Pago:      ${sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}${sale.amountReceived !== undefined ? '\nRecibido:  ' + formatMoney(sale.amountReceived) : ''}${sale.changeGiven !== undefined ? '\nCambio:    ' + formatMoney(sale.changeGiven) : ''}
━━━━━━━━━━━━━━━━━━━━
¡Gracias por su compra!`
}

export function ReceiptSheet({ sale, onClose, onCorrect }: ReceiptSheetProps) {
  const settings = useLiveQuery(() => getSettings())
  const storeName = settings?.storeName ?? 'Mi Tienda Pro'
  const customerSales = useLiveQuery(
    () => (sale?.customerId ? db.sales.where('customerId').equals(sale.customerId).toArray() : Promise.resolve([] as Sale[])),
    [sale?.customerId],
    [],
  )

  if (!sale) return null

  const ptsEarned = sale.customerId ? Math.floor(sale.total / 10) : 0
  const ptsTotal = sale.customerId ? getPts(customerSales, sale.customerId) : 0
  const text = buildReceiptText(sale, storeName)

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Recibo — ' + storeName, text })
        return
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
      }
    }
    await copy()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast('✓ Recibo copiado al portapapeles', 'purple')
    } catch {
      toast('⚠ No se pudo copiar', 'orange')
    }
  }

  return (
    <BottomSheet open={!!sale} onClose={onClose}>
      <div className="font-mono text-[12px] leading-[1.9]">
        <div className="text-center font-display text-[19px] text-lime">🏪 {storeName}</div>
        <div className="text-center text-[11px] text-muted">RECIBO DE VENTA {formatSaleId(sale.id)}</div>
        <div className="text-center text-[11px] text-muted">{formatDateTime(sale.date)}</div>
        {sale.customerName && <div className="mt-0.5 text-center text-[11px] text-lime">👤 {sale.customerName}</div>}
        {sale.fiadoName && !sale.customerId && <div className="text-center text-[11px] text-red">📋 Fiado: {sale.fiadoName}</div>}
        <div className="my-1.5 border-t border-dashed border-br2" />
        {sale.items.map((i, idx) => {
          const ul = isMeasuredUnit(i.unit) ? unitShortLabel(i.unit) : null
          return (
            <div key={idx} className="flex justify-between">
              <span>
                {i.name}
                {i.isFree ? ' 🏷️' : ''} {ul ? `${i.qty}${ul}` : `×${i.qty}`}
              </span>
              <span>{formatMoney(i.price * i.qty)}</span>
            </div>
          )
        })}
        <div className="my-1.5 border-t border-dashed border-br2" />
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatMoney(sale.subtotal ?? sale.total)}</span>
        </div>
        {sale.discount > 0 && (
          <div className="flex justify-between text-green">
            <span>Descuento</span>
            <span>-{formatMoney(sale.discount)}</span>
          </div>
        )}
        {!!sale.roundingAdjustment && (
          <div className="flex justify-between text-orange">
            <span>Ajuste</span>
            <span>
              {sale.roundingAdjustment > 0 ? '+' : ''}
              {formatMoney(sale.roundingAdjustment)}
            </span>
          </div>
        )}
        <div className="flex justify-between text-[14px] font-bold">
          <span>TOTAL</span>
          <span>{formatMoney(sale.total)}</span>
        </div>
        <div className="my-1.5 border-t border-dashed border-br2" />
        <div className="flex justify-between">
          <span>Método de pago</span>
          <span>
            {PAY_ICON[sale.payMethod]} {sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}
          </span>
        </div>
        {sale.amountReceived !== undefined && (
          <div className="flex justify-between">
            <span>Recibido</span>
            <span>{formatMoney(sale.amountReceived)}</span>
          </div>
        )}
        {sale.changeGiven !== undefined && (
          <div className="flex justify-between font-bold text-lime">
            <span>Cambio</span>
            <span>{formatMoney(sale.changeGiven)}</span>
          </div>
        )}
        {ptsEarned > 0 && (
          <div className="mt-0.5 text-center text-[11px] text-lime">
            +{ptsEarned} puntos ganados · Total: {ptsTotal} pts
          </div>
        )}
        {sale.notes && <div className="mt-2 rounded-md bg-s2 px-2 py-1.5 text-[11px] text-txt2">📝 {sale.notes}</div>}
        {sale.corrected && (
          <div className="mt-2 rounded-md border border-orange/30 bg-orange/10 px-2 py-1.5 text-[11px] text-orange">
            ✏️ Factura corregida — {sale.correctionReason}
          </div>
        )}
        <div className="mt-2 text-center text-[11px] text-muted">¡Gracias por su compra!</div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={share} className="rounded-[10px] border border-blue/30 bg-blue/10 py-2.5 text-[13px] text-blue">
          📤 Compartir
        </button>
        <button onClick={copy} className="rounded-[10px] border border-purple/30 bg-purple/10 py-2.5 text-[13px] text-purple">
          📋 Copiar texto
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          ✕ Cerrar
        </button>
        <button onClick={() => window.print()} className="rounded-[10px] bg-lime py-2.5 text-[13px] font-semibold text-black">
          🖨 Imprimir
        </button>
      </div>
      {onCorrect && sale.id !== undefined && (
        <button
          onClick={onCorrect}
          className="mt-2.5 w-full rounded-[10px] border border-orange/30 bg-orange/10 py-2.5 text-[13px] font-semibold text-orange"
        >
          ✏️ Corregir esta factura
        </button>
      )}
    </BottomSheet>
  )
}
