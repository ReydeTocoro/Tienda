import type { Product } from '../../../types/product'
import { unitShortLabel, unitFullName } from '../../../shared/lib/units'
import { formatMoney } from '../../../shared/lib/currency'
import { adjustStock } from '../../../db/repositories/products'
import { usePermission } from '../../pin/usePermission'
import { toast } from '../../../store/useToastStore'

interface ProductListItemProps {
  product: Product
  onEdit: () => void
  onDelete: () => void
}

export function ProductListItem({ product: p, onEdit, onDelete }: ProductListItemProps) {
  const { requireAdmin } = usePermission()

  async function quickStock(delta: number) {
    const ok = await requireAdmin('🔐 Ajuste de Stock', 'Se requiere PIN para modificar unidades de stock')
    if (!ok) return
    if (delta < 0 && p.stock <= 0) {
      toast('⚠ Ya está en 0', 'orange')
      return
    }
    const next = await adjustStock(p.code, delta)
    toast(`${delta > 0 ? '+' : ''}${delta} → Stock: ${next}`, delta > 0 ? 'green' : 'orange')
  }

  const low = p.stock <= p.min
  const ul = unitShortLabel(p.unit || 'unidad')
  const isMeasured = p.unit && p.unit !== 'unidad' && p.pricePer > 0
  const priceDisplay = isMeasured ? `${formatMoney(p.pricePer)} / ${ul}` : formatMoney(p.price)
  const lineValue = (p.cost || 0) * (p.stock || 0)
  const lineSale = (p.price || 0) * (p.stock || 0)
  const lineMargin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0

  return (
    <div className="mb-2.5 rounded-[14px] border border-br bg-s1 p-3.5 transition-colors lg:mb-0 lg:h-full lg:hover:border-br2 lg:hover:bg-s2">
      <div className="flex items-center justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold">
            {p.name}{' '}
            <span className={`ml-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${low ? 'border-red/30 bg-red/10 text-red' : 'border-green/30 bg-green/10 text-green'}`}>
              {low ? '⚠ Bajo' : '✓ OK'}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">
            {p.code}
            {p.brand ? (
              <>
                {' · '}
                <b>{p.brand}</b>
              </>
            ) : null}
            {p.cat ? ` · ${p.cat}` : ''}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-purple/30 bg-purple/10 px-2 py-0.5 text-[10px] text-purple">{unitFullName(p.unit)}</span>
            <span className="text-[12px] text-txt2">
              Stock: <b>{p.stock} {ul}</b> · Mín: {p.min} {ul}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2.5">
            <span className="text-[11px] text-muted">
              Invertido: <span className="font-mono font-semibold text-orange">{formatMoney(lineValue)}</span>
            </span>
            <span className="text-[11px] text-muted">
              En venta: <span className="font-mono font-semibold text-lime">{formatMoney(lineSale)}</span>
            </span>
            {p.cost > 0 && (
              <span className="text-[11px] text-muted">
                Margen: <span className="font-mono font-semibold text-green">{lineMargin.toFixed(1)}%</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[16px] font-bold text-lime">{priceDisplay}</div>
          <div className="text-[11px] text-muted">Costo: {formatMoney(p.cost)}</div>
          <div className="mt-2 flex justify-end gap-1.5">
            <button onClick={() => quickStock(-1)} title="Descontar 1" className="rounded-[8px] border border-br2 px-2.5 py-1 text-[12px] text-txt2 transition-colors hover:border-orange/40 hover:text-orange">
              −1
            </button>
            <button onClick={() => quickStock(1)} title="Sumar 1" className="rounded-[8px] border border-br2 px-2.5 py-1 text-[12px] text-txt2 transition-colors hover:border-green/40 hover:text-green">
              +1
            </button>
            <button onClick={onEdit} className="rounded-[8px] border border-br2 px-2.5 py-1 text-[12px] text-txt2 transition-colors hover:border-lime/40 hover:text-lime">
              ✏
            </button>
            <button onClick={onDelete} className="rounded-[8px] bg-red px-2.5 py-1 text-[12px] text-white transition-opacity hover:opacity-85">
              🗑
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
