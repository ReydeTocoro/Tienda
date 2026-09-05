import { forwardRef, useImperativeHandle, useMemo, useState, type RefObject } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Product } from '../../../types/product'
import { confirmEntrada, listEntradas } from '../../../db/repositories/entradas'
import { formatDateTime } from '../../../shared/lib/currency'
import { toast } from '../../../store/useToastStore'

export interface EntradaRapidaHandle {
  /** Called by the page-level barcode scanner (HID or camera) while this panel is open. */
  applyScannedCode: (code: string) => void
}

interface EntradaRapidaProps {
  products: Product[]
  open: boolean
  onToggle: () => void
  onOpenCamera: () => void
  onOpenMassive: () => void
  searchInputRef: RefObject<HTMLInputElement | null>
}

/** Single-item restock panel — legacy "Entrada de Mercancía" (index.html L1107-1177,
 * `confirmarEntrada()` L3290-3302). */
export const EntradaRapida = forwardRef<EntradaRapidaHandle, EntradaRapidaProps>(function EntradaRapida(
  { products, open, onToggle, onOpenCamera, onOpenMassive, searchInputRef },
  ref,
) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [qty, setQty] = useState(1)
  const recent = useLiveQuery(() => listEntradas(5), [], [])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || selected) return []
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)).slice(0, 8)
  }, [products, search, selected])

  function selectProduct(p: Product) {
    setSelected(p)
    setSearch(p.name)
    setQty(1)
  }

  function cancel() {
    setSelected(null)
    setSearch('')
    setQty(1)
  }

  useImperativeHandle(ref, () => ({
    applyScannedCode(code: string) {
      const p = products.find((pr) => pr.code.toLowerCase() === code.toLowerCase())
      if (p) {
        if (selected?.code === p.code) {
          setQty((q) => q + 1)
        } else {
          selectProduct(p)
        }
        toast('📦 ' + p.name, 'lime')
      } else {
        toast('❓ Código no registrado: ' + code, 'orange')
        setSelected(null)
        setSearch(code)
      }
    },
  }))

  async function confirm() {
    if (!selected) return
    if (qty <= 0) {
      toast('⚠ Ingresa una cantidad válida', 'orange')
      return
    }
    const r = await confirmEntrada(selected.code, qty)
    toast(`✓ +${qty} a "${selected.name}" → Stock: ${r.stockDespues}`, 'green')
    cancel()
  }

  return (
    <div className={`mb-3.5 overflow-hidden rounded-2xl border-2 bg-s1 transition-colors ${open ? 'border-green' : 'border-green/20'}`}>
      <button onClick={onToggle} className="flex w-full items-center justify-between px-3.5 py-3 text-left">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-green/25 bg-green/10 text-[18px]">📦</div>
          <div>
            <div className="text-[14px] font-bold">Entrada de Mercancía</div>
            <div className="text-[11px] text-muted">Escanea o busca para sumar al stock</div>
          </div>
        </div>
        <span className={`text-[20px] text-muted transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="border-t border-br p-3.5">
          <button
            onClick={onOpenMassive}
            className="mb-2.5 flex w-full items-center gap-2.5 rounded-xl border-2 border-green/25 bg-green/10 px-3.5 py-3 text-left text-green"
          >
            <span className="text-[20px]">📦</span>
            <div className="flex-1">
              <div className="text-[14px] font-bold">Escaneo Masivo de Stock</div>
              <div className="text-[11px] opacity-80">Escanea muchas unidades seguidas · cámara continua</div>
            </div>
            <span className="text-[18px]">›</span>
          </button>

          <div className="mb-2.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted">
            <div className="h-px flex-1 bg-br" /> o buscar uno a uno <div className="h-px flex-1 bg-br" />
          </div>

          <div className="mb-2.5 flex gap-2">
            <div className="relative flex-1">
              <input
                ref={searchInputRef}
                className="input font-mono"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setSelected(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const exact = products.find((p) => p.code === search.trim())
                    if (exact) selectProduct(exact)
                    else if (matches[0]) selectProduct(matches[0])
                  }
                }}
                placeholder="Código o nombre del producto..."
                autoComplete="off"
              />
              {matches.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[300] max-h-[220px] overflow-y-auto rounded-xl border border-br2 bg-s1 shadow-[var(--shadow-md)]">
                  {matches.map((p) => (
                    <div key={p.code} onMouseDown={() => selectProduct(p)} className="flex cursor-pointer items-center gap-2.5 border-b border-br px-3.5 py-2.5 last:border-b-0">
                      <div className="flex min-w-[38px] items-center justify-center rounded-[9px] bg-green/10 py-2 font-mono text-[11px] font-bold text-green">{p.stock || 0}</div>
                      <div className="min-w-0 flex-1">
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold">{p.name}</div>
                        <div className="text-[11px] text-muted">
                          {p.code}
                          {p.brand ? ' · ' + p.brand : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onOpenCamera} title="Escanear con cámara" className="flex h-[42px] w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-br2 bg-s2 text-lime">
              📷
            </button>
          </div>

          {selected && (
            <>
              <div className="mb-2.5 rounded-xl border border-br2 bg-s2 p-3.5">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <div className="text-[14px] font-bold">{selected.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted">{selected.code}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted">Stock actual</div>
                    <div className="font-mono text-[20px] font-bold text-lime">{selected.stock}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-wider text-muted">Sumar:</div>
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] border border-br2 bg-s3 text-[20px] font-bold">
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full flex-1 rounded-[9px] border border-br2 bg-s3 p-2 text-center font-mono text-[20px] font-bold text-lime outline-none"
                  />
                  <button onClick={() => setQty((q) => q + 1)} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] border border-br2 bg-s3 text-[20px] font-bold">
                    +
                  </button>
                </div>
                {qty > 0 && (
                  <div className="mt-2.5 rounded-lg bg-green/10 px-3 py-2 text-center font-mono text-[13px] text-green">
                    {selected.stock || 0} + {qty} = {(selected.stock || 0) + qty} unidades en stock
                  </div>
                )}
              </div>
              <button onClick={confirm} className="w-full rounded-xl bg-green py-3.5 text-[15px] font-extrabold text-black">
                ✓ Confirmar entrada al stock
              </button>
              <button onClick={cancel} className="mt-2 w-full py-1.5 text-[13px] text-muted">
                Cancelar
              </button>
            </>
          )}

          {recent.length > 0 && (
            <div className="mt-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Entradas recientes</div>
              {recent.map((e, i) => (
                <div key={i} className="mb-1.5 flex items-center gap-2.5 rounded-[10px] bg-s2 px-2.5 py-2">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] border border-green/25 bg-green/10 font-mono text-[13px] font-extrabold text-green">
                    +{e.qty}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold">{e.name}</div>
                    <div className="text-[11px] text-muted">
                      {e.stockAntes} → {e.stockDespues} uds
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right text-[10px] text-muted">{formatDateTime(e.date)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
