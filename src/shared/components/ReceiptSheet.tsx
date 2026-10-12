import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Mail, MessageCircle } from 'lucide-react'
import type { Sale } from '../../types/sale'
import { getSettings } from '../../db/repositories/settings'
import { BottomSheet } from './BottomSheet'
import { PrintPortal } from './PrintPortal'
import { PrintHeader } from './PrintHeader'
import { formatMoney, formatDateTime, formatQty } from '../lib/currency'
import { formatSaleId, isPendingSaleId } from '../lib/id'
import { unitShortLabel, isMeasuredUnit } from '../lib/units'
import { ACCOUNT_LABEL } from '../lib/transferAccounts'
import { toast } from '../../store/useToastStore'
import logoSrc from '../../assets/logo.png'
import { businessLines, receiptFooter } from '../lib/business'
import { receiptFromSale, receiptText } from '../lib/receipt'
import { buildReceiptPdfBlob, downloadBlob, receiptPdfFilename } from '../lib/receiptPdf'
import { ShareReceiptPanel, type ShareChannel } from './ShareReceiptPanel'
import { ReviewNotes } from './ReviewNotes'

interface ReceiptSheetProps {
  sale: Sale | null
  onClose: () => void
  onCorrect?: () => void
  onVoid?: () => void
}

export function ReceiptSheet({ sale, onClose, onCorrect, onVoid }: ReceiptSheetProps) {
  const settings = useLiveQuery(() => getSettings())
  const storeName = settings?.storeName ?? 'Mi Tienda Pro'
  const business = settings?.business
  // Which share panel is open (Correo / WhatsApp), and for which sale: another sale starts with none.
  const [panel, setPanel] = useState<{ saleId: number | undefined; channel: ShareChannel } | null>(null)

  if (!sale) return null

  const voided = !!sale.voided
  const receipt = receiptFromSale(sale, storeName, business)
  const text = receiptText(receipt)
  const channel = panel && panel.saleId === sale.id ? panel.channel : null
  // Made without internet and not on the server yet: its number is provisional, and it can't be shared or corrected from the server.
  const pending = isPendingSaleId(sale.id)

  /** Shares the receipt as an actual PDF file (so WhatsApp/etc. show it as a document, not a
   * wall of plain text) via the Web Share API's file-sharing (canShare({files})); falls back to
   * text-only sharing, then to a plain download, on browsers that support less than that. */
  async function share() {
    if (!sale) return
    const blob = await buildReceiptPdfBlob(receipt)
    const filename = receiptPdfFilename(receipt)
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
    downloadBlob(blob, filename)
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
        {businessLines(business).map((l) => (
          <div key={l} className="text-center text-[11px] text-muted">
            {l}
          </div>
        ))}
        <div className="text-center text-[11px] text-muted">{voided ? 'RECIBO ANULADO' : receipt.provisional ? 'RECIBO PROVISIONAL' : 'RECIBO DE VENTA'} {formatSaleId(sale.id)}</div>
        <div className="text-center text-[11px] text-muted">{formatDateTime(sale.date)}</div>
        {voided && (
          <div className="mx-auto my-1 max-w-[320px] rounded-md border border-red/30 bg-red/10 px-2 py-1 text-center font-sans text-[11px] leading-snug text-red">
            <b>FACTURA ANULADA</b>
            {sale.voidedAt ? ` el ${formatDateTime(sale.voidedAt)}` : ''}
            {sale.voidedBy ? ` por ${sale.voidedBy}` : ''}
            {sale.voidReason ? ` — ${sale.voidReason}` : ''}
          </div>
        )}
        {pending && (
          <div className="mx-auto my-1 max-w-[320px] rounded-md border border-orange/30 bg-orange/10 px-2 py-1 text-center font-sans text-[11px] leading-snug text-orange">
            Venta guardada sin conexión. Se envía sola al servidor cuando vuelva el internet y entonces recibe su número definitivo.
          </div>
        )}
        {sale.sellerName && <div className="text-center text-[11px] text-muted">Atendió: {sale.sellerName}</div>}
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
                {i.discount ? <span className="block text-[11px] text-green">Desc. −{formatMoney(i.discount)}</span> : null}
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
          <span>{sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}
            {sale.transferAccount ? ` · ${ACCOUNT_LABEL[sale.transferAccount]}` : ''}
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
        {sale.notes && <div className="mt-2 rounded-md bg-s2 px-2 py-1.5 text-[11px] text-txt2">{sale.notes}</div>}
        <ReviewNotes key={sale.id} sale={sale} />
        {sale.corrected && (
          <div className="mt-2 rounded-md border border-orange/30 bg-orange/10 px-2 py-1.5 text-[11px] text-orange">
            Factura corregida — {sale.correctionReason}
          </div>
        )}
        <div className="mt-2 text-center text-[11px] text-muted">{receiptFooter(business)}</div>
      </div>

      <PrintPortal>
        <div className="w-[80mm] p-2 font-mono text-[11px] leading-snug text-black">
          <PrintHeader storeName={storeName} business={business} />
          <div className="text-center text-[10px]">{voided ? 'RECIBO ANULADO' : receipt.provisional ? 'RECIBO PROVISIONAL' : 'RECIBO DE VENTA'} {formatSaleId(sale.id)}</div>
          <div className="text-center text-[10px]">{formatDateTime(sale.date)}</div>
          {voided && <div className="text-center text-[11px] font-bold">*** FACTURA ANULADA ***</div>}
          {pending && <div className="text-center text-[10px]">Venta guardada sin conexión</div>}
          {sale.sellerName && <div className="text-center text-[10px]">Atendió: {sale.sellerName}</div>}
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
                  {i.discount ? <span className="block text-[10px]">Desc. −{formatMoney(i.discount)}</span> : null}
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
            <span>{sale.payMethod.charAt(0).toUpperCase() + sale.payMethod.slice(1)}
            {sale.transferAccount ? ` · ${ACCOUNT_LABEL[sale.transferAccount]}` : ''}
          </span>
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
          {sale.notes && <div className="mt-1 text-[10px]">{sale.notes}</div>}
          {sale.corrected && (
            <div className="mt-1 text-[10px]">Factura corregida — {sale.correctionReason}</div>
          )}
          <div className="mt-1.5 text-center text-[10px]">{receiptFooter(business)}</div>
        </div>
      </PrintPortal>

      {!voided && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={share} className="rounded-[10px] border border-blue/30 bg-blue/10 py-2.5 text-[13px] text-blue">
            Compartir PDF
          </button>
          <button onClick={copy} className="rounded-[10px] border border-purple/30 bg-purple/10 py-2.5 text-[13px] text-purple">
            Copiar texto
          </button>
        </div>
      )}
      {/* Send it to the customer: by e-mail (the server mails it from the store's Gmail) or by WhatsApp
       * (a chat with a link to the receipt). The panel takes the row's place, with its own way back. */}
      {sale.id !== undefined && !pending && !voided &&
        (channel ? (
          <ShareReceiptPanel
            key={channel}
            channel={channel}
            saleId={sale.id}
            customerId={sale.customerId}
            receipt={receipt}
            onDone={() => setPanel(null)}
          />
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => setPanel({ saleId: sale.id, channel: 'correo' })}
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-lime/30 bg-lime/10 py-2.5 text-[13px] font-semibold text-lime"
            >
              <Mail size={15} />
              Correo
            </button>
            <button
              onClick={() => setPanel({ saleId: sale.id, channel: 'whatsapp' })}
              className="flex items-center justify-center gap-1.5 rounded-[10px] border border-green/30 bg-green/10 py-2.5 text-[13px] font-semibold text-green"
            >
              <MessageCircle size={15} />
              WhatsApp
            </button>
          </div>
        ))}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cerrar
        </button>
        <button onClick={() => window.print()} className="rounded-[10px] bg-lime py-2.5 text-[13px] font-semibold text-on-solid">
          Imprimir
        </button>
      </div>
      {sale.id !== undefined && !pending && !voided && (onCorrect || onVoid) && (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {onCorrect && (
            <button onClick={onCorrect} className="rounded-[10px] border border-orange/30 bg-orange/10 py-2.5 text-[13px] font-semibold text-orange">
              Corregir esta factura
            </button>
          )}
          {onVoid && (
            <button onClick={onVoid} className="rounded-[10px] border border-red/30 bg-red/10 py-2.5 text-[13px] font-semibold text-red">
              Anular esta factura
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
