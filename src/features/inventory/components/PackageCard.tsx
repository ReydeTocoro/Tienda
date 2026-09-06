import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import type { Product } from '../../../types/product'
import { formatMoney } from '../../../shared/lib/currency'
import { openPackage, sellLooseUnit, sellWholePackage } from '../../../db/repositories/inventoryOps'
import { toast } from '../../../store/useToastStore'
import { usePermission } from '../../pin/usePermission'

interface PackageCardProps {
  product: Product
  onEdit: () => void
  onDelete: () => void
}

/** "Vereda-style" dual-counter package card — legacy package section of `renderInventory()`
 * (index.html L3771-3845) plus the direct quick actions (L3976-4043). All three quick
 * actions bypassed PIN entirely in the legacy app (a real bug the plan calls out) — here
 * they all go through `requireAdmin()` first. */
export function PackageCard({ product: p, onEdit, onDelete }: PackageCardProps) {
  const suelta = useLiveQuery(() => (p.codigoSuelta ? db.products.get(p.codigoSuelta) : undefined), [p.codigoSuelta])
  const qSueltas = suelta?.stock ?? 0
  const lowPaq = p.stock <= p.min
  const lowSuel = !!suelta && qSueltas <= (suelta.min || 0)
  const lineValue = (p.cost || 0) * (p.stock || 0)
  const lineMargin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0
  const { requireAdmin } = usePermission()

  async function handleAbrir() {
    const ok = await requireAdmin('🔐 Abrir Paquete', 'Se requiere PIN para convertir un paquete en unidades sueltas')
    if (!ok) return
    try {
      const r = await openPackage(p.code, 1)
      toast(`📦 Abierto → +${r.nuevasSueltas} "${r.sueltaName}"`, 'purple')
    } catch (err) {
      toast('⚠ ' + (err instanceof Error ? err.message : String(err)), 'red')
    }
  }

  async function handleVenderUnidad() {
    const ok = await requireAdmin('🔐 Vender Unidad Suelta', 'Se requiere PIN para descontar stock')
    if (!ok) return
    try {
      await sellLooseUnit(p.code)
    } catch (err) {
      toast('⚠ ' + (err instanceof Error ? err.message : String(err)), 'red')
    }
  }

  async function handleVenderPaquete() {
    const ok = await requireAdmin('🔐 Vender Paquete', 'Se requiere PIN para descontar stock')
    if (!ok) return
    try {
      await sellWholePackage(p.code)
      toast(`📤 Vendido 1 paquete "${p.name}"`, 'blue')
    } catch (err) {
      toast('⚠ ' + (err instanceof Error ? err.message : String(err)), 'red')
    }
  }

  return (
    <div className="mb-2.5 rounded-[14px] border-2 border-purple/20 bg-s1 p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[15px] font-bold">
            {p.name}
            <span className="rounded-md border border-purple/25 bg-purple/10 px-1.5 py-0.5 text-[10px] font-bold text-purple">📦 ×{p.unidadesPor}</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">
            {p.code}
            {p.cat ? ` · ${p.cat}` : ''}
            {p.brand ? ` · ${p.brand}` : ''}
          </div>
        </div>
        <div className="ml-2 flex flex-shrink-0 gap-1.5">
          <button onClick={onEdit} className="rounded-[8px] border border-br2 px-2.5 py-1 text-[12px] text-txt2">
            ✏
          </button>
          <button onClick={onDelete} className="rounded-[8px] bg-red px-2.5 py-1 text-[12px] text-white">
            🗑
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <div className={`rounded-[14px] border-2 bg-purple/10 p-3 text-center ${lowPaq ? 'border-red' : 'border-purple/25'}`}>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-purple">📦 Paquetes</div>
          <div className={`font-mono text-[32px] font-extrabold ${lowPaq ? 'text-red' : 'text-purple'}`}>{p.stock}</div>
          <div className="mt-0.5 text-[10px] text-muted">
            × {p.unidadesPor} u/paq · {formatMoney(p.price)} c/u
          </div>
          {lowPaq && <div className="mt-0.5 text-[10px] font-bold text-red">⚠ Stock bajo</div>}
        </div>
        <div className={`rounded-[14px] border-2 bg-green/10 p-3 text-center ${lowSuel ? 'border-orange' : 'border-green/30'}`}>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-green">🔓 Sueltas</div>
          <div className={`font-mono text-[32px] font-extrabold ${lowSuel ? 'text-orange' : 'text-green'}`}>{qSueltas}</div>
          <div className="mt-0.5 text-[10px] text-muted">
            {p.nombreSuelta || 'unidad'} · {formatMoney(p.precioSuelta || 0)} c/u
          </div>
          {lowSuel && <div className="mt-0.5 text-[10px] font-bold text-orange">⚠ Pocas sueltas</div>}
        </div>
      </div>

      <div className="mb-2.5 grid grid-cols-3 gap-1.5">
        <button
          onClick={handleAbrir}
          disabled={p.stock <= 0}
          className="rounded-[11px] border-2 border-purple/30 bg-purple/10 px-1.5 py-2.5 text-[12px] font-bold text-purple disabled:pointer-events-none disabled:opacity-40"
        >
          📦 Abrir
          <br />
          <span className="text-[10px] font-normal opacity-80">paquete</span>
        </button>
        <button
          onClick={handleVenderUnidad}
          disabled={qSueltas <= 0 && p.stock <= 0}
          className="rounded-[11px] border-2 border-green/30 bg-green/10 px-1.5 py-2.5 text-[12px] font-bold text-green disabled:pointer-events-none disabled:opacity-40"
        >
          🔓 Vender
          <br />
          <span className="text-[10px] font-normal opacity-80">unidad</span>
        </button>
        <button
          onClick={handleVenderPaquete}
          disabled={p.stock <= 0}
          className="rounded-[11px] border-2 border-blue/30 bg-blue/10 px-1.5 py-2.5 text-[12px] font-bold text-blue disabled:pointer-events-none disabled:opacity-40"
        >
          📤 Vender
          <br />
          <span className="text-[10px] font-normal opacity-80">paquete</span>
        </button>
      </div>

      <div className="flex flex-wrap justify-between gap-2 rounded-[10px] bg-s2 px-2.5 py-2 text-[11px]">
        <span>
          💰 Paquete: <b className="font-mono text-lime">{formatMoney(p.price)}</b>
        </span>
        <span>
          🔓 Suelta: <b className="font-mono text-green">{formatMoney(p.precioSuelta || 0)}</b>
        </span>
        {p.cost > 0 && (
          <span>
            Margen: <b className="font-mono text-blue">{lineMargin.toFixed(1)}%</b>
          </span>
        )}
        <span>
          Invertido: <b className="font-mono text-orange">{formatMoney(lineValue)}</b>
        </span>
      </div>
    </div>
  )
}
