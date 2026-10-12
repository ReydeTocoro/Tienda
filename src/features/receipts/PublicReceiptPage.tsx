import { useEffect, useState } from 'react'
import { Download, Loader2, RotateCw } from 'lucide-react'
import logoSrc from '../../assets/logo.png'
import { businessLines, receiptFooter } from '../../shared/lib/business'
import { formatDateTime, formatMoney } from '../../shared/lib/currency'
import { payMethodLabel, receiptQty, type ReceiptData } from '../../shared/lib/receipt'
import { buildReceiptPdfBlob, downloadBlob, receiptPdfFilename } from '../../shared/lib/receiptPdf'
import { SharedReceiptError, fetchSharedReceipt } from './sharedReceipt'

/** The code in `/recibo/<code>`. */
const codeFromUrl = (): string => decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] ?? '')

type State = { kind: 'loading' } | { kind: 'ok'; receipt: ReceiptData } | { kind: 'error'; status: number; message: string }

/** The page a customer opens from the WhatsApp link (`/recibo/<code>`): the receipt of their purchase and
 * a button that builds the PDF right here, on their phone. It is outside the app's sign-in — a customer has
 * no account — and never touches the app's session code (main.tsx loads it on its own); it is a sheet of
 * paper, so it never goes dark. Drawn with JSX, never as HTML built by hand: what it shows was written by
 * the store but is readable by anyone with the link, so React escapes all of it. */
export default function PublicReceiptPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [building, setBuilding] = useState(false)
  const [pdfFailed, setPdfFailed] = useState(false)

  // A receipt is private: not indexed, and its address isn't passed along to anything it links to.
  useEffect(() => {
    document.title = 'Recibo'
    const tags = [
      ['robots', 'noindex'],
      ['referrer', 'no-referrer'],
    ].map(([name, content]) => Object.assign(document.createElement('meta'), { name, content }))
    tags.forEach((t) => document.head.appendChild(t))
    return () => tags.forEach((t) => t.remove())
  }, [])

  useEffect(() => {
    let alive = true
    fetchSharedReceipt(codeFromUrl()).then(
      (receipt) => {
        if (!alive) return
        document.title = `Recibo ${receipt.number}`
        setState({ kind: 'ok', receipt })
      },
      (err) => {
        if (alive) setState({ kind: 'error', status: err instanceof SharedReceiptError ? err.status : 0, message: err instanceof Error ? err.message : 'No encontramos este recibo' })
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  async function download(receipt: ReceiptData) {
    setBuilding(true)
    setPdfFailed(false)
    try {
      downloadBlob(await buildReceiptPdfBlob(receipt), receiptPdfFilename(receipt))
    } catch {
      setPdfFailed(true)
    } finally {
      setBuilding(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">
        <Loader2 className="mr-2 animate-spin" size={20} /> Cargando recibo…
      </div>
    )
  }

  if (state.kind === 'error') {
    // No connection, a busy server or one that failed: trying again can work. A missing or expired link can't.
    const retryable = state.status === 0 || state.status === 429 || state.status >= 500
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-txt">
        <h1 className="font-display text-lg font-bold">{state.status === 410 ? 'Este enlace venció' : retryable ? 'No pudimos cargar el recibo' : 'No encontramos este recibo'}</h1>
        <p className="max-w-xs text-sm text-muted">
          {state.status === 404
            ? 'El enlace puede estar incompleto. Pídele a la tienda que te lo envíe de nuevo.'
            : state.status === 410
              ? 'Pídele a la tienda que te lo envíe de nuevo.'
              : state.message}
        </p>
        {retryable && (
          <button
            onClick={() => {
              setState({ kind: 'loading' })
              setAttempt((a) => a + 1)
            }}
            className="flex items-center gap-2 rounded-[10px] bg-lime px-4 py-2.5 text-sm font-semibold text-on-solid"
          >
            <RotateCw size={15} /> Reintentar
          </button>
        )}
      </div>
    )
  }

  const r = state.receipt
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )

  return (
    <div className="flex min-h-dvh flex-col items-center gap-4 bg-bg px-4 py-6">
      <div className="w-full max-w-[340px] rounded-lg bg-white px-4 py-5 font-mono text-[12px] leading-[1.7] text-black shadow-md">
        <img src={logoSrc} alt="" className="mx-auto mb-1.5 h-10 w-auto object-contain" />
        <div className="text-center font-display text-[19px] text-lime">{r.storeName}</div>
        {businessLines(r.business).map((l) => (
          <div key={l} className="text-center text-[11px] text-neutral-600">
            {l}
          </div>
        ))}
        <div className="text-center text-[11px] text-neutral-600">RECIBO DE VENTA {r.number}</div>
        <div className="text-center text-[11px] text-neutral-600">{formatDateTime(r.date)}</div>
        {r.sellerName && <div className="text-center text-[11px] text-neutral-600">Atendió: {r.sellerName}</div>}
        {r.customerName && <div className="text-center text-[11px] text-lime">{r.customerName}</div>}
        {r.fiadoName && <div className="text-center text-[11px] text-neutral-600">Fiado: {r.fiadoName}</div>}
        <div className="my-1.5 border-t border-dashed border-neutral-400" />
        {r.items.map((i, k) => (
          <div key={k} className="flex justify-between gap-2">
            <span className="min-w-0 break-words">
              {i.name}
              {i.isFree ? ' [Libre]' : ''} {receiptQty(i, '×')}
              {i.discount ? <span className="block text-[11px] text-neutral-600">Desc. −{formatMoney(i.discount)}</span> : null}
            </span>
            <span className="flex-shrink-0">{formatMoney(i.price * i.qty)}</span>
          </div>
        ))}
        <div className="my-1.5 border-t border-dashed border-neutral-400" />
        {row('Subtotal', formatMoney(r.subtotal))}
        {r.discount > 0 && row('Descuento', '-' + formatMoney(r.discount))}
        {!!r.roundingAdjustment && row('Ajuste', (r.roundingAdjustment > 0 ? '+' : '') + formatMoney(r.roundingAdjustment))}
        <div className="flex justify-between gap-3 text-[14px] font-bold">
          <span>TOTAL</span>
          <span>{formatMoney(r.total)}</span>
        </div>
        <div className="my-1.5 border-t border-dashed border-neutral-400" />
        {row('Método de pago', payMethodLabel(r.payMethod, r.transferAccount))}
        {r.amountReceived !== undefined && row('Recibido', formatMoney(r.amountReceived))}
        {r.changeGiven !== undefined && row('Cambio', formatMoney(r.changeGiven), true)}
        <div className="mt-2 text-center text-[11px] text-neutral-600">{receiptFooter(r.business)}</div>
      </div>

      <button
        onClick={() => void download(r)}
        disabled={building}
        className="flex w-full max-w-[340px] items-center justify-center gap-2 rounded-xl bg-lime py-3 text-sm font-semibold text-on-solid shadow-sm transition active:scale-[0.98] disabled:opacity-70"
      >
        {building ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
        {building ? 'Preparando PDF…' : 'Descargar PDF'}
      </button>
      {pdfFailed && <p className="text-sm text-red">No se pudo crear el PDF. Inténtalo de nuevo.</p>}
    </div>
  )
}
