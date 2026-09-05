import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Product } from '../../types/product'
import { deleteProduct } from '../../db/repositories/products'
import { ProductForm } from './components/ProductForm'
import { ProductListItem } from './components/ProductListItem'
import { useConfirm } from '../../store/useConfirmStore'
import { toast } from '../../store/useToastStore'
import { formatMoney } from '../../shared/lib/currency'

export function InventarioPage() {
  const products = useLiveQuery(() => db.products.toArray(), [], []) as Product[]
  const [editing, setEditing] = useState<Product | null>(null)
  const [search, setSearch] = useState('')
  const confirm = useConfirm()

  const summary = useMemo(() => {
    const totalCostValue = products.reduce((a, p) => a + (p.cost || 0) * (p.stock || 0), 0)
    const totalSaleValue = products.reduce((a, p) => a + (p.price || 0) * (p.stock || 0), 0)
    const totalProfit = totalSaleValue - totalCostValue
    const avgMargin = totalCostValue > 0 ? (totalProfit / totalCostValue) * 100 : 0
    const lowStock = products.filter((p) => p.stock <= p.min && p.stock > 0).length
    const outStock = products.filter((p) => p.stock <= 0).length
    return { totalCostValue, totalSaleValue, totalProfit, avgMargin, lowStock, outStock }
  }, [products])

  const filtered = useMemo(() => {
    const list = products.filter((p) => !p.esUnidadSuelta)
    if (!search.trim()) return [...list].sort((a, b) => a.name.localeCompare(b.name))
    const q = search.toLowerCase()
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          (p.brand && p.brand.toLowerCase().includes(q)) ||
          (p.cat && p.cat.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, search])

  async function handleDelete(p: Product) {
    const ok = await confirm({ message: `¿Eliminar ${p.name}?`, danger: true, confirmLabel: 'Eliminar' })
    if (!ok) return
    await deleteProduct(p.code)
    if (editing?.code === p.code) setEditing(null)
    toast('Eliminado', 'muted')
  }

  return (
    <div className="p-3.5">
      <p className="mb-3.5 font-display text-[21px] font-bold">Inventario</p>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5">
        <div className="col-span-2 rounded-[14px] border border-br bg-s1 p-3.5">
          <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">💰 Inversión en Stock</div>
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Costo total invertido" value={formatMoney(summary.totalCostValue)} color="text-orange" />
            <Stat label="Valor de venta total" value={formatMoney(summary.totalSaleValue)} color="text-lime" />
            <Stat label="Ganancia potencial" value={'+' + formatMoney(summary.totalProfit)} color="text-green" small />
            <Stat label="Margen promedio" value={summary.avgMargin.toFixed(1) + '%'} color="text-blue" small />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 border-t border-br pt-2.5 text-[12px]">
            <span className="text-txt2">📦 {products.length} producto{products.length !== 1 ? 's' : ''}</span>
            {summary.lowStock > 0 && <span className="text-orange">⚠ {summary.lowStock} stock bajo</span>}
            {summary.outStock > 0 && <span className="text-red">✗ {summary.outStock} sin stock</span>}
            {summary.lowStock === 0 && summary.outStock === 0 && <span className="text-green">✓ Todo en orden</span>}
          </div>
        </div>
      </div>

      <div className="mb-3.5">
        <ProductForm product={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
      </div>

      <input
        className="search-input"
        placeholder="🔍 Buscar producto..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {!filtered.length ? (
        <div className="p-10 text-center text-muted">
          <div className="mb-2.5 text-4xl">📦</div>
          <p className="text-[13px]">Sin productos aún</p>
        </div>
      ) : (
        <div>
          {filtered.map((p) => (
            <ProductListItem key={p.code} product={p} onEdit={() => setEditing(p)} onDelete={() => handleDelete(p)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] text-muted">{label}</div>
      <div className={`font-mono font-bold ${small ? 'text-[18px]' : 'text-[22px]'} ${color}`}>{value}</div>
    </div>
  )
}
