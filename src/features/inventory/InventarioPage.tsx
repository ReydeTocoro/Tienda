import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCheck, Download, EyeOff, FileSpreadsheet, FileText, Lock, PackagePlus, ScrollText, Upload, X } from 'lucide-react'
import { db } from '../../db/index'
import type { Product } from '../../types/product'
import { adjustStock, deleteProduct } from '../../db/repositories/products'
import { ProductForm } from './components/ProductForm'
import { ProductTable } from './components/ProductTable'
import { PackageCard } from './components/PackageCard'
import { EntradaRapida, type EntradaRapidaHandle } from './components/EntradaRapida'
import { MassiveScanModal } from './components/MassiveScanModal'
import { ImportPreviewModal } from './components/ImportPreviewModal'
import { CyclicCountModal } from './components/CyclicCountModal'
import { AuditLogModal } from './components/AuditLogModal'
import { BottomSheet } from '../../shared/components/BottomSheet'
import { AddFab } from '../../shared/components/AddFab'
import { Chip } from '../../shared/components/Chip'
import { SearchInput } from '../../shared/components/SearchInput'
import { nextSort } from '../../shared/lib/sortRows'
import { useConfirm } from '../../store/useConfirmStore'
import { toast } from '../../store/useToastStore'
import { formatMoney, formatQty } from '../../shared/lib/currency'
import { useBarcodeScanner } from '../../shared/hooks/useBarcodeScanner'
import { CameraOverlay } from '../../shared/components/CameraOverlay'
import { exportExcel, exportCSV, downloadImportTemplate } from './lib/exportProducts'
import { parseImportFile, buildParsedRows, type ParsedImportRow, type DupAction } from './lib/importProducts'
import { COST_SORT_KEYS, DEFAULT_SORT, sortProducts, type SortKey, type SortState } from './lib/productSort'
import { applyImport } from '../../db/repositories/inventoryOps'
import { getSettings } from '../../db/repositories/settings'
import { secureRows, useSecureLoaded, whenSecureLoaded } from '../../db/secure'
import { useCostMap, withCosts } from '../../shared/hooks/useSecretFigures'
import { usePermission, type Need } from '../pin/usePermission'

const ALL = '__all__'

/** The purchase prices this device holds right now — for an export that runs right after signing
 * someone in, before the screen has re-rendered with the costs that just arrived. */
const freshCosts = () => new Map(secureRows('productCosts').map((r) => [r.code, Number(r.cost) || 0]))

export function InventarioPage() {
  const stored = useLiveQuery(() => db.products.toArray(), [], []) as Product[]
  // Purchase prices only reach this device while someone who may see them is signed in here.
  const costs = useCostMap()
  const products = useMemo(() => withCosts(stored, costs), [stored, costs])
  const settings = useLiveQuery(() => getSettings())
  const confirm = useConfirm()
  const { can, requirePermission } = usePermission()

  // The create/edit form lives in a dialog: opened by the floating "+" or a row's edit action.
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [formSeed, setFormSeed] = useState<{ code: string; token: number } | null>(null)
  const [packageCode, setPackageCode] = useState<string | null>(null)

  // List view: search + category filter + column sort. Purchase prices only exist for whoever may
  // see them (the server sends them to this device only then), and even so stay hidden until they
  // ask — a shared screen — going back to hidden whenever the page is left. The inventory's total
  // value is a separate permission (ganancias.ver) on top of that.
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState(ALL)
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [showCosts, setShowCosts] = useState(false)
  // Until the purchase prices have arrived, a form must not show (or send back) a cost of 0.
  const costsLoaded = useSecureLoaded('productCosts')
  const canCosts = can('costos.ver') && costsLoaded
  const costsVisible = showCosts && canCosts
  const showValue = costsVisible && can('ganancias.ver')

  // Entrada rápida + scanning
  const [entradaOpen, setEntradaOpen] = useState(false)
  const [massiveOpen, setMassiveOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [camTarget, setCamTarget] = useState<'entrada' | 'form' | null>(null)
  const entradaRef = useRef<EntradaRapidaHandle>(null)
  const entradaSearchRef = useRef<HTMLInputElement>(null)

  // Advanced tools
  const [cyclicOpen, setCyclicOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [importFileName, setImportFileName] = useState('')
  const [importRows, setImportRows] = useState<ParsedImportRow[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openCreate() {
    setEditing(null)
    setFormSeed(null)
    setFormOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setFormSeed(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setFormSeed(null)
  }

  function openFormCamera() {
    setCamTarget('form')
    setCameraOpen(true)
  }

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
    const existing = products.find((p) => p.code.toLowerCase() === code.toLowerCase())
    // With a product's form open, the scan is for its code field — how a placeholder code gets its real
    // barcode. A code another product already has is reported instead of opening that one over this form.
    if (formOpen && editing) {
      if (existing && existing.code !== editing.code) {
        toast(`Ese código ya es de "${existing.name}"`, 'orange')
        return
      }
      setFormSeed({ code, token: Date.now() })
      toast('Código leído: ' + code, 'lime')
      return
    }
    setFormSeed({ code, token: Date.now() })
    if (existing) {
      setEditing(existing)
      toast('Editando: ' + existing.name, 'lime')
    } else {
      setEditing(null)
      toast('Código nuevo listo para registrar', 'orange')
    }
    setFormOpen(true)
  }

  const scanner = useBarcodeScanner({
    onScan: handleScan,
    exceptRef: entradaSearchRef,
    hidEnabled: !massiveOpen && !cyclicOpen && !auditOpen && importRows.length === 0,
  })

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

  const byCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products])
  // Loose units auto-generated from a package are shown on the package's own row, not listed.
  const listed = useMemo(() => products.filter((p) => !p.esUnidadSuelta), [products])

  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of listed) m.set(p.cat || '', (m.get(p.cat || '') ?? 0) + 1)
    return m
  }, [listed])
  const categories = useMemo(() => [...catCounts.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'es'))), [catCounts])
  // Falls back to "all" if the chosen category disappeared (its last product was deleted/recategorized).
  const activeCat = cat === ALL || catCounts.has(cat) ? cat : ALL

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = listed.filter(
      (p) =>
        (activeCat === ALL || (p.cat || '') === activeCat) &&
        (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.brand && p.brand.toLowerCase().includes(q)) || (p.cat && p.cat.toLowerCase().includes(q))),
    )
    return sortProducts(list, sort)
  }, [listed, search, activeCat, sort])

  function handleSort(key: SortKey) {
    setSort((s) => nextSort(s, key))
  }

  async function toggleCosts() {
    if (costsVisible) {
      setShowCosts(false)
      setSort((s) => (COST_SORT_KEYS.has(s.key) ? DEFAULT_SORT : s))
      return
    }
    if (!can('costos.ver')) return
    if (!(await whenSecureLoaded('productCosts'))) toast('Los precios de compra aún no llegan: revisa la conexión', 'orange')
    setShowCosts(true)
  }

  /** Exports carry purchase prices: only for whoever may import and export the catalog (which
   * includes seeing them), once the prices have reached this device. */
  async function exportWithCosts(run: () => void) {
    if (!can('stock.importar')) return
    if (!(await whenSecureLoaded('productCosts'))) {
      toast('Los precios de compra aún no llegan: revisa la conexión e inténtalo de nuevo', 'orange')
      return
    }
    run()
  }

  /** Runs a toolbar action only if whoever is working may (or someone allowed enters their PIN). */
  async function guarded(need: Need, title: string, subtitle: string, action: () => void) {
    if (await requirePermission(need, title, subtitle)) action()
  }

  async function quickStock(p: Product, delta: number) {
    const ok = await requirePermission('stock.ajustar', 'Ajustar existencias', 'Sumar o restar unidades requiere permiso.')
    if (!ok) return
    if (delta < 0 && p.stock <= 0) {
      toast('Ya está en 0', 'orange')
      return
    }
    const next = await adjustStock(p.code, delta)
    toast(`${delta > 0 ? '+' : ''}${formatQty(delta)} → Stock: ${formatQty(next)}`, delta > 0 ? 'green' : 'orange')
  }

  async function handleDelete(p: Product) {
    if (!(await requirePermission('stock.eliminar', 'Eliminar producto', 'Borrar productos del inventario requiere permiso.'))) return
    const ok = await confirm({ message: `¿Eliminar ${p.name}?`, danger: true, confirmLabel: 'Eliminar' })
    if (!ok) return
    await deleteProduct(p.code)
    if (editing?.code === p.code) closeForm()
    toast('Eliminado', 'muted')
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const rawRows = await parseImportFile(file)
      if (!rawRows.length) {
        toast('Archivo vacío o sin datos válidos', 'orange')
        return
      }
      const { parsed, errors } = buildParsedRows(rawRows, products)
      if (!parsed.length) {
        toast('No se pudo leer ningún producto válido', 'red')
        return
      }
      setImportFileName(file.name)
      setImportRows(parsed)
      setImportErrors(errors)
    } catch (err) {
      toast('Error al leer: ' + (err instanceof Error ? err.message : String(err)), 'red')
    }
  }

  async function confirmImportRows(dupAction: DupAction) {
    const result = await applyImport(importRows, dupAction)
    let msg = `Importación: ${result.added} nuevos · ${result.updated} actualizados`
    if (result.skipped) msg += ` · ${result.skipped} omitidos`
    toast(msg, 'purple')
    setImportRows([])
    setImportErrors([])
  }

  const storeName = settings?.storeName ?? 'Mi Tienda'
  const packageProduct = packageCode ? byCode.get(packageCode) : undefined

  return (
    <div className="relative flex h-full flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 p-3.5 md:p-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-[21px] font-bold md:text-[22px]">Inventario</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <Chip>
              {listed.length} producto{listed.length !== 1 ? 's' : ''}
            </Chip>
            {summary.outStock > 0 && <Chip tone="red">{summary.outStock} sin stock</Chip>}
            {summary.lowStock > 0 && <Chip tone="orange">{summary.lowStock} stock bajo</Chip>}
          </div>
          {can('costos.ver') && (
          <button
            onClick={toggleCosts}
            className="ml-auto flex items-center gap-1.5 rounded-[10px] border border-br2 bg-s1 px-3 py-1.5 text-[12px] font-semibold text-txt2 transition-colors hover:bg-s3 hover:text-txt"
          >
            {costsVisible ? <EyeOff size={15} /> : <Lock size={15} />}
            {costsVisible ? 'Ocultar costos' : can('ganancias.ver') ? 'Ver costos e inversión' : 'Ver precios de compra'}
          </button>
          )}
        </div>

        {showValue && (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-br bg-br md:grid-cols-4">
            <Stat label="Costo total invertido" value={formatMoney(summary.totalCostValue)} color="text-orange" />
            <Stat label="Valor de venta total" value={formatMoney(summary.totalSaleValue)} color="text-lime" />
            <Stat label="Ganancia potencial" value={'+' + formatMoney(summary.totalProfit)} color="text-green" />
            <Stat label="Margen promedio" value={summary.avgMargin.toFixed(1) + '%'} color="text-blue" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar nombre, código, marca..." />
          <select value={activeCat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría" className="input w-auto min-w-[190px] py-2">
            <option value={ALL}>Todas las categorías ({listed.length})</option>
            {categories.map((c) => (
              <option key={c || '__none__'} value={c}>
                {c || 'Sin categoría'} ({catCounts.get(c)})
              </option>
            ))}
          </select>
          <div className="flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] md:w-auto md:flex-wrap md:overflow-visible">
            <ToolButton
              icon={PackagePlus}
              label="Entrada de mercancía"
              onClick={() => guarded('stock.entradas', 'Entrada de mercancía', 'Registrar mercancía que llega requiere permiso.', () => setEntradaOpen(true))}
              className="border-lime/30 bg-lime/10 text-lime hover:bg-lime/15"
            />
            {can('stock.importar') && (
              <>
                <ToolButton icon={FileSpreadsheet} label="Excel" onClick={() => exportWithCosts(() => exportExcel(withCosts(stored, freshCosts()), storeName))} iconClassName="text-green" />
                <ToolButton icon={FileText} label="CSV" onClick={() => exportWithCosts(() => exportCSV(withCosts(stored, freshCosts()), storeName))} iconClassName="text-blue" />
                <ToolButton icon={Download} label="Plantilla" onClick={() => exportWithCosts(() => downloadImportTemplate(withCosts(stored, freshCosts()), storeName))} />
                <ToolButton icon={Upload} label="Importar" onClick={() => fileInputRef.current?.click()} iconClassName="text-purple" />
              </>
            )}
            <ToolButton icon={ClipboardCheck} label="Conteo cíclico" onClick={() => setCyclicOpen(true)} iconClassName="text-orange" />
            <ToolButton icon={ScrollText} label="Auditoría" onClick={() => setAuditOpen(true)} />
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.txt,.json" className="hidden" onChange={handleFileSelected} />
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-br2 p-10 text-center text-[13px] text-muted">
            {listed.length === 0 ? 'Sin productos aún — usa el botón + para agregar el primero.' : 'Ningún producto coincide con la búsqueda o la categoría.'}
          </div>
        ) : (
          <ProductTable
            products={rows}
            byCode={byCode}
            showCosts={costsVisible}
            onRevealCosts={can('costos.ver') ? toggleCosts : undefined}
            sort={sort}
            onSort={handleSort}
            resetKey={`${search}|${activeCat}|${sort.key}|${sort.dir}`}
            onEdit={openEdit}
            onDelete={handleDelete}
            onQuickStock={quickStock}
            onOpenPackage={(p) => setPackageCode(p.code)}
          />
        )}
      </div>

      <AddFab label="Agregar producto" onClick={openCreate} />

      <BottomSheet open={formOpen} onClose={closeForm} maxWidthClass="max-w-[640px]">
        <ProductForm product={editing} showCosts={canCosts} onSaved={closeForm} onCancel={closeForm} scanSeed={formSeed} onOpenCamera={openFormCamera} />
      </BottomSheet>

      <BottomSheet open={!!packageProduct} onClose={() => setPackageCode(null)} maxWidthClass="max-w-[460px]">
        {packageProduct && (
          <PackageCard
            product={packageProduct}
            showCosts={costsVisible}
            onEdit={() => {
              setPackageCode(null)
              openEdit(packageProduct)
            }}
            onDelete={() => handleDelete(packageProduct)}
            onClose={() => setPackageCode(null)}
          />
        )}
      </BottomSheet>

      <BottomSheet open={entradaOpen} onClose={() => setEntradaOpen(false)} maxWidthClass="max-w-[520px]">
        <div className="mb-3.5 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-green/25 bg-green/10 text-green">
            <PackagePlus size={18} />
          </div>
          <div>
            <div className="text-[15px] font-bold">Entrada de Mercancía</div>
            <div className="text-[11px] text-muted">Escanea o busca para sumar al stock</div>
          </div>
          <button onClick={() => setEntradaOpen(false)} aria-label="Cerrar" className="ml-auto rounded-lg border border-br2 bg-s2 p-1.5 text-txt2">
            <X size={16} />
          </button>
        </div>
        <EntradaRapida
          ref={entradaRef}
          embedded
          products={products}
          open
          onToggle={() => setEntradaOpen(false)}
          onOpenCamera={() => {
            setCamTarget('entrada')
            setCameraOpen(true)
          }}
          onOpenMassive={() => {
            setEntradaOpen(false)
            setMassiveOpen(true)
          }}
          searchInputRef={entradaSearchRef}
        />
      </BottomSheet>

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

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0 bg-s1 px-3.5 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`break-words font-mono text-[14px] font-bold md:text-[17px] ${color}`}>{value}</div>
    </div>
  )
}

/** The toolbar's secondary buttons share one neutral look; only the icon carries the tool's color. */
const TOOL_NEUTRAL = 'border-br2 bg-s1 text-txt2 hover:bg-s3 hover:text-txt'

function ToolButton({
  icon: Icon,
  label,
  onClick,
  className = TOOL_NEUTRAL,
  iconClassName,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  label: string
  onClick: () => void
  className?: string
  iconClassName?: string
}) {
  return (
    <button onClick={onClick} className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] border px-3 py-2 text-[12px] font-semibold transition-colors ${className}`}>
      <Icon size={15} className={iconClassName} />
      {label}
    </button>
  )
}
