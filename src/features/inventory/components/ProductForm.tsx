import { useEffect, useState } from 'react'
import type { Product } from '../../../types/product'
import { UNITS, isMeasuredUnit } from '../../../types/unit'
import { unitShortLabel } from '../../../shared/lib/units'
import { addProduct, updateProduct } from '../../../db/repositories/products'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'

const MARGIN_PRESETS = [10, 15, 20, 25, 30, 50, 100]

const UNIT_GROUPS: Array<{ label: string; values: string[] }> = [
  { label: '📦 Conteo', values: ['unidad', 'docena', 'caja', 'paquete', 'par'] },
  { label: '⚖️ Peso', values: ['kg', 'g', 'lb', 'oz', 't'] },
  { label: '💧 Volumen', values: ['L', 'ml', 'gal', 'fl_oz'] },
  { label: '📏 Longitud', values: ['m', 'cm', 'mm', 'ft', 'in', 'yd'] },
  { label: '📐 Área', values: ['m2', 'ft2'] },
]

const EMPTY = {
  code: '',
  name: '',
  cost: '',
  margin: '',
  price: '',
  brand: '',
  unit: 'unidad',
  pricePer: '',
  stock: '',
  min: '',
  cat: '',
}

interface ProductFormProps {
  product: Product | null
  onSaved: () => void
  onCancel: () => void
}

export function ProductForm({ product, onSaved, onCancel }: ProductFormProps) {
  const [f, setF] = useState(EMPTY)
  const confirm = useConfirm()
  const editing = !!product

  useEffect(() => {
    if (product) {
      const margin = product.cost > 0 && product.price > 0 ? (((product.price - product.cost) / product.cost) * 100).toFixed(1) : ''
      setF({
        code: product.code,
        name: product.name,
        cost: product.cost ? String(product.cost) : '',
        margin,
        price: product.price ? String(product.price) : '',
        brand: product.brand || '',
        unit: product.unit || 'unidad',
        pricePer: product.pricePer ? String(product.pricePer) : '',
        stock: product.stock ? String(product.stock) : '',
        min: product.min ? String(product.min) : '',
        cat: product.cat || '',
      })
    } else {
      setF(EMPTY)
    }
  }, [product])

  const isMeasured = isMeasuredUnit(f.unit)
  const unitLbl = unitShortLabel(f.unit)

  function set<K extends keyof typeof EMPTY>(key: K, val: string) {
    setF((s) => ({ ...s, [key]: val }))
  }

  function calcFromCost(cost: string, margin: string) {
    const c = parseFloat(cost) || 0
    const m = parseFloat(margin) || 0
    if (c > 0 && m >= 0) {
      setF((s) => ({ ...s, cost, margin, price: (c * (1 + m / 100)).toFixed(2) }))
    } else {
      setF((s) => ({ ...s, cost, margin }))
    }
  }

  function calcFromPrice(price: string) {
    const c = parseFloat(f.cost) || 0
    const p = parseFloat(price) || 0
    if (c > 0 && p > c) {
      setF((s) => ({ ...s, price, margin: (((p - c) / c) * 100).toFixed(1) }))
    } else {
      setF((s) => ({ ...s, price }))
    }
  }

  const cost = parseFloat(f.cost) || 0
  const price = parseFloat(f.price) || 0
  const gain = price - cost
  const gainPct = cost > 0 ? (gain / cost) * 100 : 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const code = f.code.trim()
    const name = f.name.trim()
    if (!name) {
      toast('⚠ Escribe el nombre', 'orange')
      return
    }
    if (!code) {
      toast('⚠ Escribe el código', 'orange')
      return
    }
    if (cost > 0 && price > 0 && cost > price) {
      const ok = await confirm(
        `⚠ El precio de compra ($${cost.toFixed(2)}) es mayor al precio de venta ($${price.toFixed(2)}). ¿Continuar de todas formas?`,
      )
      if (!ok) return
    }

    const prod: Product = {
      code,
      name,
      price,
      cost,
      stock: parseFloat(f.stock) || 0,
      min: parseFloat(f.min) || 0,
      cat: f.cat.trim(),
      brand: f.brand.trim(),
      unit: f.unit,
      pricePer: isMeasured ? parseFloat(f.pricePer) || 0 : 0,
      esPaquete: product?.esPaquete ?? false,
      unidadesPor: product?.unidadesPor,
      codigoSuelta: product?.codigoSuelta,
      nombreSuelta: product?.nombreSuelta,
      precioSuelta: product?.precioSuelta,
      esUnidadSuelta: product?.esUnidadSuelta,
      codigoPaquete: product?.codigoPaquete,
      nombrePaquete: product?.nombrePaquete,
      createdAt: product?.createdAt ?? new Date().toISOString(),
    }

    try {
      if (editing) {
        await updateProduct(prod)
        toast('✓ Producto actualizado', 'lime')
      } else {
        await addProduct(prod)
        toast('✓ Producto guardado', 'lime')
      }
      setF(EMPTY)
      onSaved()
    } catch (err) {
      toast('⚠ ' + (err instanceof Error ? err.message : String(err)), 'orange')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[14px] border border-br bg-s1 p-3.5">
      <p className="mb-3 text-[14px] font-bold">{editing ? `✏ Editando: ${product!.name}` : '➕ Agregar Producto'}</p>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Código / Barcode">
          <input
            className="input"
            value={f.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="001 o barcode"
            disabled={editing}
          />
        </Field>
        <Field label="Nombre *">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Nombre del producto" />
        </Field>

        <div className="col-span-2 rounded-xl border border-br2 bg-s2 p-3">
          <label className="mb-2 block text-[10px] uppercase tracking-wider text-muted">💰 Precio y Margen</label>
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Precio Compra" value={f.cost} onChange={(v) => calcFromCost(v, f.margin)} />
            <NumField label="% Ganancia" value={f.margin} onChange={(v) => calcFromCost(f.cost, v)} accent />
            <NumField label="Precio Venta" value={f.price} onChange={calcFromPrice} />
          </div>
          {cost > 0 && price > 0 && (
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-s1 px-3 py-2 text-[12px] text-muted">
              <span>Ganancia por unidad:</span>
              <div className="flex gap-3">
                <span className={gain >= 0 ? 'font-mono font-bold text-green' : 'font-mono font-bold text-red'}>
                  {gain >= 0 ? '+' : ''}${gain.toFixed(2)}
                </span>
                <span className="font-mono font-semibold text-lime">{gainPct.toFixed(1)}%</span>
              </div>
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {MARGIN_PRESETS.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => calcFromCost(f.cost, String(p))}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-bold ${
                  Math.round(parseFloat(f.margin) || -1) === p ? 'border-lime bg-lime/15 text-lime' : 'border-br2 bg-s3 text-txt2'
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        <Field label="Marca">
          <input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Ej: Nestlé, Colgate..." />
        </Field>
        <Field label="Unidad de venta">
          <select className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNIT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.values.map((v) => (
                  <option key={v} value={v}>
                    {UNITS.find((u) => u.value === v)?.label ?? v}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {isMeasured && (
          <Field label={`Precio por ${unitLbl}`} span2>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={f.pricePer}
              onChange={(e) => set('pricePer', e.target.value)}
              placeholder="0.00"
            />
          </Field>
        )}

        <Field label="Stock actual">
          <div className="flex items-center gap-1.5">
            <input
              className="input flex-1"
              type="number"
              min={0}
              step="0.001"
              value={f.stock}
              onChange={(e) => set('stock', e.target.value)}
              placeholder="0"
            />
            <span className="whitespace-nowrap text-[12px] text-muted">{unitLbl}</span>
          </div>
        </Field>
        <Field label="Stock mínimo">
          <div className="flex items-center gap-1.5">
            <input
              className="input flex-1"
              type="number"
              min={0}
              step="0.001"
              value={f.min}
              onChange={(e) => set('min', e.target.value)}
              placeholder="5"
            />
            <span className="whitespace-nowrap text-[12px] text-muted">{unitLbl}</span>
          </div>
        </Field>

        <Field label="Categoría" span2>
          <input className="input" value={f.cat} onChange={(e) => set('cat', e.target.value)} placeholder="Bebidas, Snacks, Limpieza..." />
        </Field>
      </div>

      <div className="mt-3 flex gap-2">
        {editing && (
          <button
            type="button"
            onClick={() => {
              setF(EMPTY)
              onCancel()
            }}
            className="rounded-[10px] border border-br2 px-4 py-2.5 text-[13px] font-semibold text-txt2"
          >
            Cancelar
          </button>
        )}
        <button type="submit" className="flex-1 rounded-[10px] bg-lime py-3 text-[15px] font-bold text-black">
          {editing ? 'Actualizar Producto' : 'Guardar Producto'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${span2 ? 'col-span-2' : ''}`}>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</label>
      {children}
    </div>
  )
}

function NumField({ label, value, onChange, accent }: { label: string; value: string; onChange: (v: string) => void; accent?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <input
        className={`input ${accent ? 'border-lime font-bold text-lime' : ''}`}
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
      />
    </div>
  )
}
