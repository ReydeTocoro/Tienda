import type { BusinessInfo } from '../../types/settings'
import { businessLines } from '../lib/business'
import logoSrc from '../../assets/logo.png'

/** Logo, store name and the business details (NIT, phone, address — Configuración → Negocio),
 * centered — the header of every thermal-printed slip (receipts, Reporte X). Print is monochrome
 * on a real thermal printer, so this (and its siblings in a print view) uses plain black text
 * instead of the brand color tokens. */
export function PrintHeader({ storeName, business }: { storeName: string; business?: BusinessInfo }) {
  return (
    <div className="mb-1.5 text-center">
      <img src={logoSrc} alt="" className="mx-auto mb-1 h-14 w-auto object-contain" />
      <div className="text-[13px] font-bold">{storeName}</div>
      {businessLines(business).map((l) => (
        <div key={l} className="text-[10px]">
          {l}
        </div>
      ))}
    </div>
  )
}
