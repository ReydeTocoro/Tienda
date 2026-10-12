import logoSrc from '../../assets/logo.png'
import { receiptText, type ReceiptData } from './receipt'

/** jsPDF's standard fonts (incl. "courier", used below to keep `receiptText`'s manual column-spacing
 * intact) have no emoji glyphs — WinAnsi/StandardEncoding only — so they're stripped rather than left
 * to render as boxes/blanks in the PDF. */
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

/** The receipt as a PDF on an 80 mm roll — real text, a few KB, sharp and selectable. It is what the
 * cashier shares as a file, what goes attached to the e-mail and what a customer downloads from the
 * WhatsApp link (built on their own phone: no PDF is ever stored anywhere). jsPDF is heavy, so it is
 * loaded here, when someone asks for a PDF, not when the app opens. */
export async function buildReceiptPdfBlob(receipt: ReceiptData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const lines = stripEmojiForPdf(receiptText(receipt))
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

export function receiptPdfFilename(receipt: Pick<ReceiptData, 'number' | 'provisional'>): string {
  // "PEND-0003" keeps its prefix: stripped to its digits it would be named like the real receipt #0003.
  if (receipt.provisional) return `Recibo-${receipt.number}.pdf`
  return `Recibo-${receipt.number.replace(/\D/g, '').padStart(4, '0')}.pdf`
}

/** Plain base64 (no `data:` prefix) — what the e-mail route takes for the attachment. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Saves a PDF the way a browser downloads any file. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
