import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Calculator } from 'lucide-react'
import { db } from '../../db/index'
import type { Product } from '../../types/product'
import type { Sale } from '../../types/sale'
import { isMeasuredUnit } from '../../types/unit'
import { selectActiveCart, useActiveCart, useCartStore } from '../../store/useCartStore'
import { useBarcodeScanner } from '../../shared/hooks/useBarcodeScanner'
import { CameraOverlay } from '../../shared/components/CameraOverlay'
import { ScanFlashOverlay } from '../../shared/components/ScanFlashOverlay'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import { toast } from '../../store/useToastStore'
import type { SortState } from '../../shared/lib/sortRows'
import { ALL, DEFAULT_SALE_SORT, buildSaleList, type SaleSortKey } from './lib/saleProducts'
import { ProductPicker } from './components/ProductPicker'
import { CartPanel } from './components/CartPanel'
import { WeightModal } from './components/WeightModal'
import { CalculatorModal } from './components/CalculatorModal'
import { QuickDiscountModal } from './components/QuickDiscountModal'
import { CajaBanner } from '../cash/components/CajaBanner'
import { useFinalizeSale } from './hooks/useFinalizeSale'

export function VentaPage() {
  const products = useLiveQuery(() => db.products.toArray(), [], []) as Product[]

  const [search, setSearch] = useState('')
  // The row of the list the arrow keys are on (-1: none yet).
  const [rowIdx, setRowIdx] = useState(-1)
  const [activeCat, setActiveCat] = useState(ALL)
  const [sort, setSort] = useState<SortState<SaleSortKey>>(DEFAULT_SALE_SORT)
  const [weightModal, setWeightModal] = useState<{ product: Product; editIndex: number | null } | null>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [discOpen, setDiscOpen] = useState(false)
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [flash, setFlash] = useState<{ show: boolean; success: boolean }>({ show: false, success: true })

  const searchRef = useRef<HTMLInputElement>(null)
  // What the table shows: typing narrows it (and marks the word), and the arrow keys walk down it.
  const list = useMemo(() => buildSaleList(products, search, activeCat, sort), [products, search, activeCat, sort])
  const activeRow = rowIdx >= 0 ? list.rows[Math.min(rowIdx, list.rows.length - 1)] : undefined
  const items = useActiveCart((c) => c.items)
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
    setRowIdx(-1)
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

  // F9 opens and closes the calculator from anywhere on Venta, even from a field: it is a function
  // key, so it types nothing. Not while a dialog is open — the calculator would hide behind it.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'F9' || e.defaultPrevented || document.querySelector('dialog[open]')) return
      e.preventDefault()
      setCalcOpen((o) => !o)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

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
    if (!list.rows.length) {
      toast('Producto no encontrado', 'orange')
      return
    }
    // One match goes in; several: the first one is marked, and Enter again takes it (↓ moves to another).
    if (list.rows.length === 1) pickAndClear(list.rows[0])
    else setRowIdx(0)
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setRowIdx((i) => Math.min(i + 1, list.rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setRowIdx((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeRow) pickAndClear(activeRow)
      else addItemFromSearch()
    } else if (e.key === 'Escape') {
      setSearch('')
      setRowIdx(-1)
    }
  }

  function handleEditMeasured(index: number) {
    const item = selectActiveCart(useCartStore.getState()).items[index]
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
      {/* Left column carries everything that finds products (search, table); the cart is a
       * standalone card in the right column spanning the full height — it's the thing the cashier
       * watches the whole time, so it owns its title, customer and Cobrar button. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-[52%] flex-shrink-0 flex-col overflow-hidden md:w-[56%] xl:w-[58%]">
          <CajaBanner />

          <div className="flex flex-shrink-0 gap-2 px-3 py-2 md:px-4">
            <div className="relative flex-1">
              <input
                id="venta-search-input"
                ref={searchRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setRowIdx(-1)
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar producto por nombre o código..."
                autoComplete="off"
                className="input md:h-[42px] md:text-[15px]"
              />
            </div>
            <button
              onClick={() => setCameraOpen(true)}
              title="Escanear código"
              className="flex h-[42px] w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-br2 bg-s1 text-lime transition-colors hover:border-lime/40 hover:bg-s2"
            >
              <Camera size={19} />
            </button>
            <button
              onClick={() => setCalcOpen((o) => !o)}
              title="Calculadora (F9)"
              className="flex h-[42px] w-11 flex-shrink-0 items-center justify-center rounded-[10px] border border-br2 bg-s1 text-blue transition-colors hover:border-blue/40 hover:bg-s2"
            >
              <Calculator size={19} />
            </button>
          </div>

          <div className="min-h-0 flex-1 border-t border-br">
            <ProductPicker
              list={list}
              total={products.length}
              cart={items}
              search={search}
              sort={sort}
              onSort={setSort}
              onSetCat={setActiveCat}
              onPick={pickProduct}
              activeCode={activeRow?.code}
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
      <CalculatorModal open={calcOpen} onClose={() => setCalcOpen(false)} />
      <QuickDiscountModal open={discOpen} onClose={() => setDiscOpen(false)} />
      <ReceiptSheet sale={receiptSale} onClose={() => setReceiptSale(null)} />
      <CameraOverlay open={cameraOpen} videoRef={scanner.videoRef} onClose={() => setCameraOpen(false)} />
      <ScanFlashOverlay show={flash.show} success={flash.success} />
    </div>
  )
}
