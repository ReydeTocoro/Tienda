import { useMemo, useState } from 'react'
import type { Product } from '../../../types/product'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { applyCyclicCountAdjustments } from '../../../db/repositories/inventoryOps'
import { getSettings } from '../../../db/repositories/settings'
import { toast } from '../../../store/useToastStore'

interface CyclicCountModalProps {
  open: boolean
  onClose: () => void
  products: Product[]
}

/** Conteo cíclico — legacy `openConteoCiclico()`/`aplicarAjustesConteo()` (index.html L5659-5810).
 * Each applied difference is written to the audit log (Fase 6 will gate the "apply" action
 * behind PIN, fixing the legacy bug where this bypassed it entirely). */
export function CyclicCountModal({ open, onClose, products }: CyclicCountModalProps) {
  const [catFilter, setCatFilter] = useState('__all__')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.cat).filter(Boolean))).sort(), [products])
  const filtered = useMemo(() => (catFilter === '__all__' ? products : products.filter((p) => (p.cat || '') === catFilter)), [products, catFilter]);

  const diffs = useMemo(
    () =>
      Object.entries(counts).filter(([code, qty]) => {
        const p = products.find((x) => x.code === code)
        return p && qty !== (p.stock || 0)
      }),
    [counts, products],
  )

  function reset() {
    setCounts({})
    setReasons({})
    setCatFilter('__all__')
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function apply() {
    if (!diffs.length) {
      toast('No hay diferencias que ajustar', 'default')
      return
    }
    const missing = diffs.filter(([code]) => !reasons[code]?.trim())
    if (missing.length) {
      toast('⚠ Completa el motivo de cada diferencia', 'orange')
      return
    }
    setBusy(true)
    try {
      const settings = await getSettings()
      const n = await applyCyclicCountAdjustments(
        diffs.map(([code, counted]) => ({ code, counted, reason: reasons[code] })),
        settings.lastCajero || 'Usuario',
      )
      toast(`✓ ${n} ajuste${n !== 1 ? 's' : ''} aplicado${n !== 1 ? 's' : ''} y registrados`, 'orange')
      handleClose()
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <BottomSheet open={open} onClose={handleClose} maxWidthClass="max-w-[720px]" zIndexClass="z-[3000]">
      <div className="mb-3.5 flex items-center justify-between">
        <div>
          <p className="font-display text-[18px] font-bold">🔢 Conteo Cíclico de Stock</p>
          <p className="mt-0.5 text-[12px] text-muted">Compara el stock del sistema con el conteo físico real</p>
        </div>
        <button onClick={handleClose} className="rounded-lg border border-br2 bg-s2 px-3 py-1.5 text-[12px] text-txt2">
          ✕
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => setCatFilter('__all__')}
          className={`rounded-full border px-3 py-1 text-[12px] ${catFilter === '__all__' ? 'border-green/40 bg-green/15 font-bold text-green' : 'border-br2 bg-s2 text-txt2'}`}
        >
          Todos
        </button>
        {cats.map((c) => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className={`rounded-full border px-3 py-1 text-[12px] ${catFilter === c ? 'border-green/40 bg-green/15 font-bold text-green' : 'border-br2 bg-s2 text-txt2'}`}
          >
            {c}
          </button>
        ))}
      </div>

      {diffs.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 rounded-[10px] bg-s2 p-2.5 text-center">
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Con diferencia</div>
            <div className="font-mono text-[16px] font-bold text-orange">{diffs.length}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Contados</div>
            <div className="font-mono text-[16px] font-bold text-green">{Object.keys(counts).length}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted">Sin contar</div>
            <div className="font-mono text-[16px] font-bold text-muted">{filtered.length - Object.keys(counts).length}</div>
          </div>
        </div>
      )}

      <div className="mb-3.5 max-h-[380px] overflow-y-auto">
        {filtered.map((p) => {
          const counted = counts[p.code]
          const hasCounted = counted !== undefined
          const diff = hasCounted ? counted - (p.stock || 0) : null
          return (
            <div key={p.code} className={`mb-2 rounded-xl border p-3 ${hasCounted ? (diff === 0 ? 'border-green/30' : 'border-red/30') : 'border-br'} bg-s1`}>
              <div className="mb-2 flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold">{p.name}</div>
                  <div className="font-mono text-[10px] text-muted">
                    {p.code}
                    {p.cat ? ' · ' + p.cat : ''}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-[10px] text-muted">Sistema</div>
                  <div className="font-mono text-[18px] font-bold text-lime">{p.stock || 0}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap text-[11px] font-semibold text-muted">Conteo físico:</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Cantidad real"
                  value={hasCounted ? counted : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setCounts((s) => {
                      const next = { ...s }
                      if (v === '') delete next[p.code]
                      else next[p.code] = Math.max(0, parseFloat(v) || 0)
                      return next
                    })
                  }}
                  className={`input flex-1 text-right ${hasCounted ? 'border-lime' : ''}`}
                />
                {hasCounted && (
                  <div className={`min-w-[90px] text-right text-[12px] font-bold ${diff === 0 ? 'text-green' : diff! > 0 ? 'text-lime' : 'text-red'}`}>
                    {diff === 0 ? '✓ Correcto' : diff! > 0 ? `+${diff} sobrante` : `${diff} faltante`}
                  </div>
                )}
              </div>
              {hasCounted && diff !== 0 && (
                <input
                  type="text"
                  placeholder="Motivo de la diferencia (requerido) — Ej: Merma, error en recepción, robo..."
                  value={reasons[p.code] || ''}
                  onChange={(e) => setReasons((s) => ({ ...s, [p.code]: e.target.value }))}
                  className="input mt-2 border-orange text-[12px]"
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2">
        <button onClick={handleClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cerrar
        </button>
        {diffs.length > 0 && (
          <button disabled={busy} onClick={apply} className="flex-[2] rounded-[10px] bg-orange py-2.5 text-[14px] font-extrabold text-black disabled:opacity-60">
            ⚠ Aplicar {diffs.length} ajuste{diffs.length !== 1 ? 's' : ''} de inventario
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
