import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Calculator } from 'lucide-react'
import { db } from '../../db/index'
import type { Product } from '../../types/product'
import type { Sale } from '../../types/sale'
import { isMeasuredUnit } from '../../types/unit'
import { useCartStore } from '../../store/useCartStore'
import { useBarcodeScanner } from '../../shared/hooks/useBarcodeScanner'
import { CameraOverlay } from '../../shared/components/CameraOverlay'
import { ScanFlashOverlay } from '../../shared/components/ScanFlashOverlay'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import { toast } from '../../store/useToastStore'
import { searchMatches } from './lib/search'
import { ProductGrid } from './components/ProductGrid'
import { CartPanel } from './components/CartPanel'
import { SearchDropdown } from './components/SearchDropdown'
import { WeightModal } from './components/WeightModal'
import { FreeProductModal } from './components/FreeProductModal'
import { CalculatorModal } from './components/CalculatorModal'
import { QuickDiscountModal } from './components/QuickDiscountModal'
import { VentaKpiBar } from './components/VentaKpiBar'
import { CajaBanner } from '../cash/components/CajaBanner'
import { useFinalizeSale } from './hooks/useFinalizeSale'

export function VentaPage() {
  const products = useLiveQuery(() => db.products.toArray(), [], []) as Product[]

  const [search, setSearch] = useState('')
  const [ddFocus, setDdFocus] = useState(-1)
  const [activeCat, setActiveCat] = useState('__all__')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [weightModal, setWeightModal] = useState<{ product: Product; editIndex: number | null } | null>(null)
  const [freeModal, setFreeModal] = useState<{ open: boolean; prefill: number | null }>({ open: false, prefill: null })
  const [calcOpen, setCalcOpen] = useState(false)
  const [discOpen, setDiscOpen] = useState(false)
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [flash, setFlash] = useState<{ show: boolean; success: boolean }>({ show: false, success: true })

  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownMatches = useMemo(() => searchMatches(products, search), [products, search])
  const items = useCartStore((s) => s.items)
  const addUnitItem = useCartStore((s) => s.addUnitItem)
  const finalize = useFinalizeSale()

  function flashOnce(success: boolean) {
    setFlash({ show: true, success })
    setTimeout(() => setFlash({ show: false, success }), 180)
  }

  function pickProduct(p: Product) {
    if (p.stock <= 0) {
      toast('Sin stock disponible', 'orange')
      return
    }
    if (isMeasuredUnit(p.unit)) {
      setWeightModal({ product: p, editIndex: null })
    } else {
      addUnitItem(p, 1)
    }
  }

  function pickAndClear(p: Product) {
    pickProduct(p)
    setSearch('')
    setDdFocus(-1)
  }

  function handleScan(code: string) {
    const trimmed = code.trim()
    const exact = products.find((p) => p.code.toLowerCase() === trimmed.toLowerCase())
    if (exact) {
      if (exact.stock <= 0) {
        flashOnce(false)
        toast('Sin stock: ' + exact.name, 'orange')
      } else {
        flashOnce(true)
        if (isMeasuredUnit(exact.unit)) setWeightModal({ product: exact, editIndex: null })
        else addUnitItem(exact, 1)
      }
    } else {
      flashOnce(false)
      toast('Código no registrado: ' + trimmed, 'orange')
      setSearch(trimmed)
    }
    if (cameraOpen) setCameraOpen(false)
  }

  const scanner = useBarcodeScanner({ onScan: handleScan, exceptRef: searchRef })

  useEffect(() => {
    if (cameraOpen) scanner.start()
    else scanner.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen])

  function addItemFromSearch() {
    const q = search.trim().toLowerCase()
    if (!q) return
    const exact = products.find((p) => p.code.toLowerCase() === q)
    if (exact) {
      pickAndClear(exact)
      return
    }
    const matches = dropdownMatches
    if (!matches.length) {
      toast('Producto no encontrado', 'orange')
      return
    }
    if (matches.length === 1) {
      pickAndClear(matches[0])
    } else {
      setDdFocus(0)
    }
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const matches = dropdownMatches
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDdFocus((f) => Math.min(f + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDdFocus((f) => Math.max(f - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (ddFocus >= 0 && matches[ddFocus]) pickAndClear(matches[ddFocus])
      else addItemFromSearch()
    } else if (e.key === 'Escape') {
      setSearch('')
      setDdFocus(-1)
    }
  }

  function handleEditMeasured(index: number) {
    const item = useCartStore.getState().items[index]
    if (!item) return
    const product = products.find((p) => p.code === item.code)
    if (!product) return
    setWeightModal({ product, editIndex: index })
  }

  async function handleCheckout() {
    const sale = await finalize()
    if (sale) setReceiptSale(sale)
  }

  return (
    <div className="mx-auto flex h-full max-w-[1800px] flex-col">
      {/* Left column carries everything that finds products (KPIs, search, grid); the cart is a
       * standalone card in the right column spanning the full height — it's the thing the cashier
       * watches the whole time, so it owns its title, customer and Cobrar button. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-[52%] flex-shrink-0 flex-col overflow-hidden md:w-[56%] xl:w-[58%]">
          <CajaBanner />
          <VentaKpiBar onClickLowStock={() => setLowStockOnly(true)} />

          <div className="flex flex-shrink-0 gap-2 px-3 py-2 md:px-4">
            <div className="relative flex-1">
              <input
                id="venta-search-input"
                ref={searchRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setDdFocus(-1)
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar producto por nombre o código..."
                autoComplete="off"
                className="input md:h-[42px] md:text-[15px]"
              />
              <SearchDropdown matches={dropdownMatches} query={search} focusIndex={ddFocus} onHover={setDdFocus} onSelect={pickAndClear} />
            </div>
            <button
              onClick={() => setCameraOpen(true)}
              title="Escanear código"
              className="flex h-[42px] w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-br2 bg-s2 text-lime transition-colors hover:border-lime/40 hover:bg-s3"
            >
              <Camera size={19} />
            </button>
            <button
              onClick={() => setCalcOpen((o) => !o)}
              title="Calculadora"
              className="flex h-[42px] w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-br2 bg-s2 text-blue transition-colors hover:border-blue/40 hover:bg-s3"
            >
              <Calculator size={19} />
            </button>
          </div>

          {lowStockOnly && (
            <button
              onClick={() => setLowStockOnly(false)}
              className="mx-3 mb-2 flex-shrink-0 rounded-lg border border-orange/30 bg-orange/10 px-3 py-1.5 text-left text-[12px] text-orange transition-colors hover:bg-orange/15 md:mx-4"
            >
              Mostrando solo stock bajo — toca para quitar el filtro
            </button>
          )}

          <div className="min-h-0 flex-1 border-t border-br">
            <ProductGrid
              products={products}
              cart={items}
              search={search}
              activeCat={activeCat}
              onSetCat={setActiveCat}
              onPick={pickProduct}
              onOpenFree={() => setFreeModal({ open: true, prefill: null })}
              lowStockOnly={lowStockOnly}
            />
          </div>
        </div>
        <div className="flex-1 overflow-hidden p-2 md:p-3">
          <CartPanel products={products} onEditMeasured={handleEditMeasured} onOpenDiscount={() => setDiscOpen(true)} onCheckout={handleCheckout} />
        </div>
      </div>

      {weightModal && (
        <WeightModal product={weightModal.product} editIndex={weightModal.editIndex} onClose={() => setWeightModal(null)} />
      )}
      <FreeProductModal open={freeModal.open} prefillPrice={freeModal.prefill} onClose={() => setFreeModal({ open: false, prefill: null })} />
      <CalculatorModal
        open={calcOpen}
        onClose={() => setCalcOpen(false)}
        onUseAsPrice={(v) => {
          setCalcOpen(false)
          setFreeModal({ open: true, prefill: v })
        }}
      />
      <QuickDiscountModal open={discOpen} onClose={() => setDiscOpen(false)} />
      <ReceiptSheet sale={receiptSale} onClose={() => setReceiptSale(null)} />
      <CameraOverlay open={cameraOpen} videoRef={scanner.videoRef} onClose={() => setCameraOpen(false)} />
      <ScanFlashOverlay show={flash.show} success={flash.success} />
    </div>
  )
}
