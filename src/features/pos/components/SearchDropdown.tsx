import type { Product } from '../../../types/product'
import { formatMoney } from '../../../shared/lib/currency'
import { unitShortLabel, unitFullName, isMeasuredUnit } from '../../../shared/lib/units'

interface SearchDropdownProps {
  matches: Product[]
  query: string
  focusIndex: number
  onHover: (i: number) => void
  onSelect: (p: Product) => void
}

export function SearchDropdown({ matches, query, focusIndex, onHover, onSelect }: SearchDropdownProps) {
  if (!query.trim()) return null

  return (
    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[300] max-h-[300px] overflow-y-auto rounded-xl border border-br2 bg-s1 shadow-[var(--shadow-md)]">
      {!matches.length ? (
        <div className="p-4 text-center text-[13px] text-muted">
          ❌ Sin resultados para "<b>{query}</b>"
        </div>
      ) : (
        <>
          <div className="border-b border-br bg-s2 px-3.5 py-1.5 field-label">
            {matches.length} resultado{matches.length !== 1 ? 's' : ''} — ↑↓ navegar · Enter seleccionar
          </div>
          {matches.map((p, i) => {
            const out = p.stock <= 0
            const low = !out && p.stock <= p.min
            const ul = unitShortLabel(p.unit || 'unidad')
            const measured = isMeasuredUnit(p.unit)
            return (
              <div
                key={p.code}
                onMouseDown={() => onSelect(p)}
                onMouseEnter={() => onHover(i)}
                className={`flex cursor-pointer items-center gap-2.5 border-b border-br px-3.5 py-2.5 last:border-b-0 ${
                  i === focusIndex ? 'bg-s2' : ''
                }`}
              >
                <div
                  className={`flex min-w-[38px] items-center justify-center rounded-[9px] py-2 text-center font-mono text-[12px] font-bold ${
                    out ? 'bg-red/10 text-red' : low ? 'bg-orange/10 text-orange' : 'bg-lime/10 text-lime'
                  }`}
                >
                  {out ? '✗' : p.stock}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold">{p.name}</div>
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted">
                    {p.code}
                    {p.brand || p.cat ? ` · ${[p.brand, p.cat].filter(Boolean).join(' · ')}` : ''}
                  </div>
                </div>
                <div className="ml-auto flex-shrink-0 pl-2 text-right">
                  <div className="font-mono text-[13px] font-semibold text-lime">
                    {measured && p.pricePer ? `${formatMoney(p.pricePer)}/${ul}` : formatMoney(p.price)}
                  </div>
                  <div className={`mt-0.5 text-[10px] ${out ? 'text-red' : low ? 'text-orange' : 'text-muted'}`}>
                    {out ? '✗ Sin stock' : `${p.stock} ${ul}`}
                  </div>
                  {measured && <div className="mt-0.5 text-[10px] text-purple">⚖️ {unitFullName(p.unit)}</div>}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
