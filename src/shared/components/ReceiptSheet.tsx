import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import { getSettings } from '../../db/repositories/settings'
import { BottomSheet } from './BottomSheet'
import { PrintPortal } from './PrintPortal'
import { PrintHeader } from './PrintHeader'
import { formatMoney, formatDateTime, formatQty } from '../lib/currency'
import { formatSaleId } from '../lib/id'
import { unitShortLabel, isMeasuredUnit } from '../lib/units'
import { getPts } from '../lib/loyalty'
import { toast } from '../../store/useToastStore'
import logoSrc from '../../assets/logo.png'

interface ReceiptSheetProps {
  sale: Sale | null
  onClose: () => void
  onCorrect?: () => void
}

function buildReceiptText(sale: Sale, storeName: string): string {
  const itemLines = sale.items
    .map((i) => {
      const ul = isMeasuredUnit(i.unit) ? unitShortLabel(i.unit) : null
      const qtyStr = ul ? `${formatQty(i.qty)}${ul}` : `x${formatQty(i.qty)}`
      return `  ${i.name}${i.isFree ? ' [Libre]' : ''} ${qtyStr}  $${formatMoney(i.price * i.qty).slice(1)}`
    })
    .join('\n')

  return `${storeName.toUpperCase()}
━━━━━━━━━━━━━━━━━━━━
RECIBO DE VENTA ${formatSaleId(sale.id)}
${formatDateTime(sale.date)}${sale.customerName ? '\n' + sale.customerName : ''}${sale.fiadoName && !sale.customerId ? '\nFiado: ' + sale.fiadoName : ''}
━━━━━━━━━━━━━━━━━━━━
${itemLines}
━━━━━━━━━━━━━━━━━━━━
Subtotal: ${formatMoney(sale.subtotal ?? sale.total)}${sale.discount ? '\nDescuento: -' + formatMoney(sale.discount) : ''}${sale.roundingAdjustment ? '\nAjuste: ' + (sale.roundingAdjustment > 0 ? '+' : '') + formatMoney(sale.roundingAdjustment) : ''}
TOTAL: ${formatMoney(sale.total)}
Pago: ${sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}${sale.amountReceived !== undefined ? '\nRecibido: ' + formatMoney(sale.amountReceived) : ''}${sale.changeGiven !== undefined ? '\nCambio: ' + formatMoney(sale.changeGiven) : ''}
━━━━━━━━━━━━━━━━━━━━
¡Gracias por su compra!`
}

/** jsPDF's standard fonts (incl. "courier", used below to keep buildReceiptText's manual
 * column-spacing intact) have no emoji glyphs — WinAnsi/StandardEncoding only — so they're
 * stripped rather than left to render as boxes/blanks in the PDF. */
function stripEmojiForPdf(text: string): string[] {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\u{FE0F}/gu, '')
    .replace(/━/g, '-')
    .split('\n')
    .map((l) => l.trimStart())
}

/** Loaded once and reused: jsPDF's `addImage` accepts a decoded `HTMLImageElement` directly, no
 * need to fetch/base64-encode the bundled logo ourselves. */
let logoImgPromise: Promise<HTMLImageElement> | null = null
function getLogoImage(): Promise<HTMLImageElement> {
  logoImgPromise ??= new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo'))
    img.src = logoSrc
  })
  return logoImgPromise
}

async function buildReceiptPdfBlob(sale: Sale, storeName: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const lines = stripEmojiForPdf(buildReceiptText(sale, storeName))
  const fontSize = 9
  const lineHeight = 4.2 // mm — comfortably clears 9pt courier's line advance
  const marginX = 4
  const marginY = 6
  const width = 80 // mm — standard thermal-receipt width
  const logoW = 34 // mm

  // The logo is a nice-to-have on the PDF: a slow/blocked image load never blocks the receipt.
  let logo: HTMLImageElement | null = null
  try {
    logo = await getLogoImage()
  } catch {
    // no logo — the text receipt below still prints fine without it
  }
  const logoH = logo ? logoW * (logo.naturalHeight / logo.naturalWidth) : 0
  const topOffset = logo ? logoH + 3 : 0

  const doc = new jsPDF({ unit: 'mm', format: [width, marginY * 2 + topOffset + lines.length * lineHeight] })
  if (logo) doc.addImage(logo, 'PNG', (width - logoW) / 2, marginY - 3, logoW, logoH)
  doc.setFont('courier')
  doc.setFontSize(fontSize)
  lines.forEach((line, i) => doc.text(line, marginX, marginY + topOffset + i * lineHeight))
  return doc.output('blob')
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

  /** Shares the receipt as an actual PDF file (so WhatsApp/etc. show it as a document, not a
   * wall of plain text) via the Web Share API's file-sharing (canShare({files})); falls back to
   * text-only sharing, then to a plain download, on browsers that support less than that. */
  async function share() {
    if (!sale) return
    const blob = await buildReceiptPdfBlob(sale, storeName)
    const filename = `Recibo-${String(sale.id ?? 0).padStart(4, '0')}.pdf`
    const file = new File([blob], filename, { type: 'application/pdf' })

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Recibo — ' + storeName })
        return
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Recibo — ' + storeName, text })
        return
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
      }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast('Recibo PDF descargado', 'purple')
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast('Recibo copiado al portapapeles', 'purple')
    } catch {
      toast('No se pudo copiar', 'orange')
    }
  }

  return (
    <BottomSheet open={!!sale} onClose={onClose}>
      {/* Printed output never shows this on-screen card — it prints PrintableReceipt below
       * instead, formatted for 80mm thermal paper regardless of what's visible on screen. */}
      <div className="font-mono text-[12px] leading-[1.9]">
        <img src={logoSrc} alt="" className="mx-auto mb-1.5 h-10 w-auto object-contain" />
        <div className="text-center font-display text-[19px] text-lime">{storeName}</div>
        <div className="text-center text-[11px] text-muted">RECIBO DE VENTA {formatSaleId(sale.id)}</div>
        <div className="text-center text-[11px] text-muted">{formatDateTime(sale.date)}</div>
        {sale.customerName && <div className="mt-0.5 text-center text-[11px] text-lime">{sale.customerName}</div>}
        {sale.fiadoName && !sale.customerId && <div className="text-center text-[11px] text-red">Fiado: {sale.fiadoName}</div>}
        <div className="my-1.5 border-t border-dashed border-br2" />
        {sale.items.map((i, idx) => {
          const ul = isMeasuredUnit(i.unit) ? unitShortLabel(i.unit) : null
          return (
            <div key={idx} className="flex justify-between">
              <span>
                {i.name}
                {i.isFree ? ' [Libre]' : ''} {ul ? `${formatQty(i.qty)}${ul}` : `×${formatQty(i.qty)}`}
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
          <span>{sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}</span>
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
            +{formatQty(ptsEarned)} puntos ganados · Total: {formatQty(ptsTotal)} pts
          </div>
        )}
        {sale.notes && <div className="mt-2 rounded-md bg-s2 px-2 py-1.5 text-[11px] text-txt2">{sale.notes}</div>}
        {sale.corrected && (
          <div className="mt-2 rounded-md border border-orange/30 bg-orange/10 px-2 py-1.5 text-[11px] text-orange">
            Factura corregida — {sale.correctionReason}
          </div>
        )}
        <div className="mt-2 text-center text-[11px] text-muted">¡Gracias por su compra!</div>
      </div>

      <PrintPortal>
        <div className="w-[80mm] p-2 font-mono text-[11px] leading-snug text-black">
          <PrintHeader storeName={storeName} />
          <div className="text-center text-[10px]">RECIBO DE VENTA {formatSaleId(sale.id)}</div>
          <div className="text-center text-[10px]">{formatDateTime(sale.date)}</div>
          {sale.customerName && <div className="text-center text-[10px]">{sale.customerName}</div>}
          {sale.fiadoName && !sale.customerId && <div className="text-center text-[10px]">Fiado: {sale.fiadoName}</div>}
          <div className="my-1 border-t border-dashed border-black" />
          {sale.items.map((i, idx) => {
            const ul = isMeasuredUnit(i.unit) ? unitShortLabel(i.unit) : null
            return (
              <div key={idx} className="flex justify-between gap-2">
                <span>
                  {i.name}
                  {i.isFree ? ' [Libre]' : ''} {ul ? `${formatQty(i.qty)}${ul}` : `x${formatQty(i.qty)}`}
                </span>
                <span className="flex-shrink-0">{formatMoney(i.price * i.qty)}</span>
              </div>
            )
          })}
          <div className="my-1 border-t border-dashed border-black" />
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatMoney(sale.subtotal ?? sale.total)}</span>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between">
              <span>Descuento</span>
              <span>-{formatMoney(sale.discount)}</span>
            </div>
          )}
          {!!sale.roundingAdjustment && (
            <div className="flex justify-between">
              <span>Ajuste</span>
              <span>
                {sale.roundingAdjustment > 0 ? '+' : ''}
                {formatMoney(sale.roundingAdjustment)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[13px] font-bold">
            <span>TOTAL</span>
            <span>{formatMoney(sale.total)}</span>
          </div>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="flex justify-between">
            <span>Método de pago</span>
            <span>{sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}</span>
          </div>
          {sale.amountReceived !== undefined && (
            <div className="flex justify-between">
              <span>Recibido</span>
              <span>{formatMoney(sale.amountReceived)}</span>
            </div>
          )}
          {sale.changeGiven !== undefined && (
            <div className="flex justify-between font-bold">
              <span>Cambio</span>
              <span>{formatMoney(sale.changeGiven)}</span>
            </div>
          )}
          {ptsEarned > 0 && (
            <div className="mt-1 text-center text-[10px]">
              +{formatQty(ptsEarned)} puntos ganados · Total: {formatQty(ptsTotal)} pts
            </div>
          )}
          {sale.notes && <div className="mt-1 text-[10px]">{sale.notes}</div>}
          {sale.corrected && (
            <div className="mt-1 text-[10px]">Factura corregida — {sale.correctionReason}</div>
          )}
          <div className="mt-1.5 text-center text-[10px]">¡Gracias por su compra!</div>
        </div>
      </PrintPortal>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={share} className="rounded-[10px] border border-blue/30 bg-blue/10 py-2.5 text-[13px] text-blue">
          Compartir PDF
        </button>
        <button onClick={copy} className="rounded-[10px] border border-purple/30 bg-purple/10 py-2.5 text-[13px] text-purple">
          Copiar texto
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cerrar
        </button>
        <button onClick={() => window.print()} className="rounded-[10px] bg-lime py-2.5 text-[13px] font-semibold text-on-solid">
          Imprimir
        </button>
      </div>
      {onCorrect && sale.id !== undefined && (
        <button
          onClick={onCorrect}
          className="mt-2.5 w-full rounded-[10px] border border-orange/30 bg-orange/10 py-2.5 text-[13px] font-semibold text-orange"
        >
          Corregir esta factura
        </button>
      )}
    </BottomSheet>
  )
}
