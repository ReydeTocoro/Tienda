import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Product } from '../../types/product'
import { deleteProduct } from '../../db/repositories/products'
import { ProductForm } from './components/ProductForm'
import { ProductListItem } from './components/ProductListItem'
import { PackageCard } from './components/PackageCard'
import { EntradaRapida, type EntradaRapidaHandle } from './components/EntradaRapida'
import { MassiveScanModal } from './components/MassiveScanModal'
import { ImportPreviewModal } from './components/ImportPreviewModal'
import { CyclicCountModal } from './components/CyclicCountModal'
import { AuditLogModal } from './components/AuditLogModal'
import { useConfirm } from '../../store/useConfirmStore'
import { toast } from '../../store/useToastStore'
import { formatMoney } from '../../shared/lib/currency'
import { useBarcodeScanner } from '../../shared/hooks/useBarcodeScanner'
import { CameraOverlay } from '../../shared/components/CameraOverlay'
import { exportExcel, exportCSV, downloadImportTemplate } from './lib/exportProducts'
import { parseImportFile, buildParsedRows, type ParsedImportRow, type DupAction } from './lib/importProducts'
import { applyImport } from '../../db/repositories/inventoryOps'
import { getSettings } from '../../db/repositories/settings'
import { usePermission } from '../pin/usePermission'

export function InventarioPage() {
  const products = useLiveQuery(() => db.products.toArray(), [], []) as Product[]
  const settings = useLiveQuery(() => getSettings())
  const [editing, setEditing] = useState<Product | null>(null)
  const [search, setSearch] = useState('')
  const confirm = useConfirm()
  const { requireAdmin } = usePermission()

  // Entrada rápida + scanning
  const [entradaOpen, setEntradaOpen] = useState(false)
  const [massiveOpen, setMassiveOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [camTarget, setCamTarget] = useState<'entrada' | 'form' | null>(null)
  const [formSeed, setFormSeed] = useState<{ code: string; token: number } | null>(null)
  const entradaRef = useRef<EntradaRapidaHandle>(null)
  const entradaSearchRef = useRef<HTMLInputElement>(null)

  // Advanced tools
  const [cyclicOpen, setCyclicOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [importFileName, setImportFileName] = useState('')
  const [importRows, setImportRows] = useState<ParsedImportRow[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleScan(code: string) {
    if (cameraOpen && camTarget) {
      routeScan(code, camTarget)
      setCameraOpen(false)
      setCamTarget(null)
      return
    }
    routeScan(code, entradaOpen ? 'entrada' : 'form')
  }

  function routeScan(code: string, target: 'entrada' | 'form') {
    if (target === 'entrada') {
      entradaRef.current?.applyScannedCode(code)
      return
    }
    setFormSeed({ code, token: Date.now() })
    const existing = products.find((p) => p.code.toLowerCase() === code.toLowerCase())
    if (existing) {
      setEditing(existing)
      toast('📦 Editando: ' + existing.name, 'lime')
    } else {
      setEditing(null)
      toast('➕ Código nuevo listo para registrar', 'orange')
    }
  }

  const scanner = useBarcodeScanner({ onScan: handleScan, exceptRef: entradaSearchRef, hidEnabled: !massiveOpen })

  useEffect(() => {
    if (cameraOpen) scanner.start()
    else scanner.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen])

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
      .filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand && p.brand.toLowerCase().includes(q)) || (p.cat && p.cat.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, search])

  async function handleDelete(p: Product) {
    const isAdmin = await requireAdmin('🔐 Eliminar Producto', 'Se requiere PIN para eliminar del inventario')
    if (!isAdmin) return
    const ok = await confirm({ message: `¿Eliminar ${p.name}?`, danger: true, confirmLabel: 'Eliminar' })
    if (!ok) return
    await deleteProduct(p.code)
    if (editing?.code === p.code) setEditing(null)
    toast('Eliminado', 'muted')
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const rawRows = await parseImportFile(file)
      if (!rawRows.length) {
        toast('⚠ Archivo vacío o sin datos válidos', 'orange')
        return
      }
      const { parsed, errors } = buildParsedRows(rawRows, products)
      if (!parsed.length) {
        toast('❌ No se pudo leer ningún producto válido', 'red')
        return
      }
      setImportFileName(file.name)
      setImportRows(parsed)
      setImportErrors(errors)
    } catch (err) {
      toast('❌ Error al leer: ' + (err instanceof Error ? err.message : String(err)), 'red')
    }
  }

  async function confirmImportRows(dupAction: DupAction) {
    const summary = await applyImport(importRows, dupAction)
    let msg = `✓ Importación: ${summary.added} nuevos · ${summary.updated} actualizados`
    if (summary.skipped) msg += ` · ${summary.skipped} omitidos`
    toast(msg, 'purple')
    setImportRows([])
    setImportErrors([])
  }

  return (
    <div className="p-3.5 lg:mx-auto lg:max-w-[1600px] lg:p-6">
      <p className="mb-3.5 font-display text-[21px] font-bold lg:text-[26px]">Inventario</p>

      <div className="lg:flex lg:items-start lg:gap-6">
        {/* Tools column — restock + product form. Sticky on desktop so it stays in view while
            the product list on the right scrolls. */}
        <div className="lg:sticky lg:top-6 lg:w-[380px] lg:flex-shrink-0">
          <EntradaRapida
            ref={entradaRef}
            products={products}
            open={entradaOpen}
            onToggle={() => setEntradaOpen((o) => !o)}
            onOpenCamera={() => {
              setCamTarget('entrada')
              setCameraOpen(true)
            }}
            onOpenMassive={() => setMassiveOpen(true)}
            searchInputRef={entradaSearchRef}
          />

          <div className="mb-3.5 rounded-[14px] border border-br bg-s1 p-3.5">
            <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">💰 Inversión en Stock</div>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Costo total invertido" value={formatMoney(summary.totalCostValue)} color="text-orange" />
              <Stat label="Valor de venta total" value={formatMoney(summary.totalSaleValue)} color="text-lime" />
              <Stat label="Ganancia potencial" value={'+' + formatMoney(summary.totalProfit)} color="text-green" small />
              <Stat label="Margen promedio" value={summary.avgMargin.toFixed(1) + '%'} color="text-blue" small />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 border-t border-br pt-2.5 text-[12px]">
              <span className="text-txt2">
                📦 {products.length} producto{products.length !== 1 ? 's' : ''}
              </span>
              {summary.lowStock > 0 && <span className="text-orange">⚠ {summary.lowStock} stock bajo</span>}
              {summary.outStock > 0 && <span className="text-red">✗ {summary.outStock} sin stock</span>}
              {summary.lowStock === 0 && summary.outStock === 0 && <span className="text-green">✓ Todo en orden</span>}
            </div>
          </div>

          <div className="mb-3.5 lg:mb-0">
            <ProductForm
              product={editing}
              onSaved={() => setEditing(null)}
              onCancel={() => setEditing(null)}
              scanSeed={formSeed}
              onOpenCamera={() => {
                setCamTarget('form')
                setCameraOpen(true)
              }}
            />
          </div>
        </div>

        {/* Browse column — search, bulk tools, and the product list as a card grid on desktop. */}
        <div className="lg:min-w-0 lg:flex-1">
          <input className="search-input" placeholder="🔍 Buscar producto..." value={search} onChange={(e) => setSearch(e.target.value)} />

          <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <button onClick={() => exportExcel(products, settings?.storeName ?? 'Mi Tienda')} className="rounded-[10px] border border-green/25 bg-green/10 py-2.5 text-[12px] font-semibold text-green transition-colors hover:bg-green/15">
              📊 Exportar Excel
            </button>
            <button onClick={() => exportCSV(products, settings?.storeName ?? 'Mi Tienda')} className="rounded-[10px] border border-blue/25 bg-blue/10 py-2.5 text-[12px] font-semibold text-blue transition-colors hover:bg-blue/15">
              📄 Exportar CSV
            </button>
            <button onClick={() => downloadImportTemplate(products, settings?.storeName ?? 'Mi Tienda')} className="rounded-[10px] border border-br2 bg-s2 py-2.5 text-[12px] text-txt2 transition-colors hover:bg-s3">
              📋 Plantilla CSV
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="rounded-[10px] border border-purple/25 bg-purple/10 py-2.5 text-[12px] font-semibold text-purple transition-colors hover:bg-purple/15">
              📥 Importar CSV/Excel
            </button>
          </div>
          <div className="mb-3.5 grid grid-cols-2 gap-2 lg:max-w-md">
            <button onClick={() => setCyclicOpen(true)} className="rounded-[10px] border border-orange/25 bg-orange/10 py-2.5 text-[12px] font-semibold text-orange transition-colors hover:bg-orange/15">
              🔢 Conteo Cíclico
            </button>
            <button onClick={() => setAuditOpen(true)} className="rounded-[10px] border border-br2 bg-s2 py-2.5 text-[12px] text-txt2 transition-colors hover:bg-s3">
              📋 Log de Auditoría
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt,.json" className="hidden" onChange={handleFileSelected} />

          {!filtered.length ? (
            <div className="p-10 text-center text-muted">
              <div className="mb-2.5 text-4xl">📦</div>
              <p className="text-[13px]">Sin productos aún</p>
            </div>
          ) : (
            <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 xl:grid-cols-3">
              {filtered.map((p) =>
                p.esPaquete ? (
                  <PackageCard key={p.code} product={p} onEdit={() => setEditing(p)} onDelete={() => handleDelete(p)} />
                ) : (
                  <ProductListItem key={p.code} product={p} onEdit={() => setEditing(p)} onDelete={() => handleDelete(p)} />
                ),
              )}
            </div>
          )}
        </div>
      </div>

      <MassiveScanModal open={massiveOpen} onClose={() => setMassiveOpen(false)} products={products} />
      <ImportPreviewModal
        open={importRows.length > 0}
        fileName={importFileName}
        parsed={importRows}
        errors={importErrors}
        onClose={() => {
          setImportRows([])
          setImportErrors([])
        }}
        onConfirm={confirmImportRows}
      />
      <CyclicCountModal open={cyclicOpen} onClose={() => setCyclicOpen(false)} products={products} />
      <AuditLogModal open={auditOpen} onClose={() => setAuditOpen(false)} />
      <CameraOverlay
        open={cameraOpen}
        videoRef={scanner.videoRef}
        onClose={() => {
          setCameraOpen(false)
          setCamTarget(null)
        }}
      />
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
