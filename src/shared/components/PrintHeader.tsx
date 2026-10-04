import logoSrc from '../../assets/logo.png'

/** Logo + store name, centered — the header of every thermal-printed slip (receipts, Reporte X).
 * Print is monochrome on a real thermal printer, so this (and its siblings in a print view) uses
 * plain black text instead of the brand color tokens. */
export function PrintHeader({ storeName }: { storeName: string }) {
  return (
    <div className="mb-1.5 text-center">
      <img src={logoSrc} alt="" className="mx-auto mb-1 h-14 w-auto object-contain" />
      <div className="text-[13px] font-bold">{storeName}</div>
    </div>
  )
}
