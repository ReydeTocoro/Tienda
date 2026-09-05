import { useRef, useState } from 'react'
import type { Product } from '../../../types/product'
import { useBarcodeScanner } from '../../../shared/hooks/useBarcodeScanner'
import { confirmEntradasBulk } from '../../../db/repositories/entradas'
import { addProduct } from '../../../db/repositories/products'
import { toast } from '../../../store/useToastStore'

interface LogEntry {
  code: string
  name: string
  qty: number
  isNew: boolean
  newMeta?: { price: number; cost: number; cat: string }
}

interface MassiveScanModalProps {
  open: boolean
  onClose: () => void
  products: Product[]
}

/** Bulk stock-in scanning — camera OR HID, continuous, with inline "register unknown code"
 * flow. Legacy "Escaneo Masivo de Stock" (index.html L6089-6510). This is one of the two
 * real call sites (besides Venta) that validates `useBarcodeScanner`'s camera half. */
export function MassiveScanModal({ open, onClose, products }: MassiveScanModalProps) {
  const [mode, setMode] = useState<'cam' | 'hid'>('cam')
  const [log, setLog] = useState<LogEntry[]>([])
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newCost, setNewCost] = useState('')
  const [newCat, setNewCat] = useState('')
  const [busy, setBusy] = useState(false)
  const cooldownRef = useRef(false)
  const pausedRef = useRef(false)

  function addToLog(code: string, name: string, isNew: boolean, newMeta?: LogEntry['newMeta']) {
    setLog((prev) => {
      const idx = prev.findIndex((e) => e.code === code)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { code, name, qty: 1, isNew, newMeta }]
    })
  }

  function handleCode(code: string) {
    if (!open || cooldownRef.current || pausedRef.current) return
    cooldownRef.current = true
    setTimeout(() => {
      cooldownRef.current = false
    }, 1500)
    if (navigator.vibrate) navigator.vibrate(60)

    const prod = products.find((p) => p.code === code)
    if (prod) {
      addToLog(code, prod.name, false)
    } else {
      pausedRef.current = true
      setPendingCode(code)
      setNewName('')
      setNewPrice('')
      setNewCost('')
      setNewCat('')
    }
  }

  const scanner = useBarcodeScanner({ onScan: handleCode, hidEnabled: open && mode === 'hid' })

  function switchMode(next: 'cam' | 'hid') {
    if (next === mode) return
    if (mode === 'cam') scanner.stop()
    setMode(next)
    if (next === 'cam') scanner.start()
  }

  // Start/stop camera when the modal opens/closes while in camera mode.
  const wasOpen = useRef(false)
  if (open && !wasOpen.current && mode === 'cam') {
    wasOpen.current = true
    scanner.start()
  } else if (!open && wasOpen.current) {
    wasOpen.current = false
    scanner.stop()
  }

  function saveNewProduct() {
    if (!pendingCode) return
    if (!newName.trim()) {
      toast('⚠ Escribe el nombre', 'orange')
      return
    }
    const price = parseFloat(newPrice) || 0
    if (!price) {
      toast('⚠ Escribe el precio', 'orange')
      return
    }
    addToLog(pendingCode, newName.trim(), true, { price, cost: parseFloat(newCost) || 0, cat: newCat.trim() })
    setPendingCode(null)
    pausedRef.current = false
  }

  function skipUnknown() {
    setPendingCode(null)
    pausedRef.current = false
  }

  function undoLast() {
    setLog((prev) => {
      if (!prev.length) return prev
      const last = prev[prev.length - 1]
      if (last.qty > 1) return [...prev.slice(0, -1), { ...last, qty: last.qty - 1 }]
      return prev.slice(0, -1)
    })
  }

  function clearAll() {
    setLog([])
  }

  async function finalize() {
    if (!log.length) return
    setBusy(true)
    try {
      let totalUnidades = 0
      for (const e of log) {
        if (e.isNew && e.newMeta) {
          await addProduct({
            code: e.code,
            name: e.name,
            price: e.newMeta.price,
            cost: e.newMeta.cost,
            cat: e.newMeta.cat,
            brand: '',
            stock: 0,
            min: 0,
            unit: 'unidad',
            pricePer: 0,
            esPaquete: false,
            createdAt: new Date().toISOString(),
          })
        }
        totalUnidades += e.qty
      }
      await confirmEntradasBulk(
        log.map((e) => ({ code: e.code, qty: e.qty })),
        'masivo',
      )
      toast(`✓ ${totalUnidades} ud${totalUnidades !== 1 ? 's' : ''} agregadas a ${log.length} producto${log.length !== 1 ? 's' : ''}`, 'green')
      setLog([])
      onClose()
    } catch (err) {
      toast('⚠ ' + (err instanceof Error ? err.message : String(err)), 'orange')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const totalUnidades = log.reduce((a, e) => a + e.qty, 0)

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col bg-bg">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-br bg-s1 px-4 py-3">
        <button onClick={onClose} className="flex-shrink-0 rounded-[10px] border border-br2 bg-s2 px-3 py-1.5 text-[13px] font-bold text-txt2">
          ✕ Cerrar
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[16px] font-bold text-green">📦 Escaneo Masivo de Stock</div>
          <div className="text-[11px] text-muted">{pendingCode ? '⏸ Código nuevo — completa los datos' : 'Apunta al código de barras'}</div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-4">
          <div className="text-center">
            <div className="font-mono text-[26px] font-bold leading-none text-lime">{totalUnidades}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted">unidades</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-[18px] font-bold leading-none text-blue">{log.length}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted">productos</div>
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-br bg-s2 px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Modo:</span>
        <button
          onClick={() => switchMode('cam')}
          className={`rounded-[10px] border px-3.5 py-1.5 text-[12px] font-bold ${mode === 'cam' ? 'border-green/40 bg-green/15 text-green' : 'border-br2 text-txt2'}`}
        >
          📷 Cámara
        </button>
        <button
          onClick={() => switchMode('hid')}
          className={`rounded-[10px] border px-3.5 py-1.5 text-[12px] font-bold ${mode === 'hid' ? 'border-green/40 bg-green/15 text-green' : 'border-br2 text-txt2'}`}
        >
          📡 Lector USB/HID
        </button>
      </div>

      {mode === 'cam' ? (
        <div className="relative h-[200px] flex-shrink-0 bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={scanner.videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-20 w-[260px] rounded-lg border-2 border-green" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
          </div>
          {pendingCode && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-center text-white">
                <div className="mb-2 text-3xl">⏸</div>
                <div className="text-[13px] font-semibold">Completar producto nuevo</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-shrink-0 border-b border-br bg-s2 px-6 py-5">
          <div className="flex min-h-[70px] items-center justify-center rounded-[14px] border-2 border-br2 bg-s1 px-5 py-4">
            <div className="text-center">
              <div className="mb-1 text-3xl">📡</div>
              <div className="text-[13px] text-muted">Apunta el lector al código de barras</div>
            </div>
          </div>
        </div>
      )}

      {pendingCode && (
        <div className="flex-shrink-0 border-b border-br bg-s2 px-4 py-3">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[18px]">🆕</span>
            <div>
              <div className="text-[13px] font-bold text-orange">Código nuevo detectado</div>
              <div className="text-[11px] text-muted">{pendingCode}</div>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <input className="input border-lime" placeholder="Nombre *" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <input className="input border-lime" type="number" placeholder="Precio Venta *" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
            <input className="input" type="number" placeholder="Costo (opcional)" value={newCost} onChange={(e) => setNewCost(e.target.value)} />
            <input className="input" placeholder="Categoría (opcional)" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button onClick={saveNewProduct} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-extrabold text-black">
              ✓ Guardar y continuar
            </button>
            <button onClick={skipUnknown} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
              Ignorar
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3.5">
        <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Productos escaneados</div>
        {!log.length ? (
          <div className="py-10 text-center text-muted">
            <div className="mb-2.5 text-4xl">📦</div>
            <div className="mb-1 text-[13px] font-semibold">Sin productos escaneados</div>
            <div className="text-[12px]">Escanea con la cámara o el lector USB para comenzar</div>
          </div>
        ) : (
          [...log].reverse().map((e) => {
            const prod = products.find((p) => p.code === e.code)
            const stockActual = prod?.stock ?? 0
            return (
              <div key={e.code} className={`mb-1.5 flex items-center gap-2.5 rounded-xl border bg-s1 p-2.5 ${e.isNew ? 'border-orange' : 'border-br'}`}>
                <div className={`flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[10px] font-mono text-[15px] font-extrabold ${e.isNew ? 'bg-orange/10 text-orange' : 'bg-green/10 text-green'}`}>
                  +{e.qty}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-bold">
                    {e.name}
                    {e.isNew && <span className="ml-1.5 rounded bg-orange/15 px-1.5 py-0.5 text-[10px] font-bold text-orange">NUEVO</span>}
                  </div>
                  <div className="font-mono text-[10px] text-muted">{e.code}</div>
                </div>
                <div className="flex-shrink-0 text-right font-mono text-[11px] text-muted">
                  Stock: {stockActual}
                  <div className="text-lime">→ {stockActual + e.qty}</div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-2.5 border-t border-br bg-s1 px-4 py-3">
        {log.length > 0 && (
          <>
            <button onClick={undoLast} className="flex-shrink-0 rounded-[10px] border border-red/30 bg-red/10 px-4 py-2.5 text-[13px] font-bold text-red">
              ↩ Deshacer
            </button>
            <button onClick={clearAll} className="flex-shrink-0 rounded-[10px] border border-br2 px-3.5 py-2.5 text-[12px] text-muted">
              🗑 Limpiar
            </button>
          </>
        )}
        {log.length > 0 ? (
          <button disabled={busy} onClick={finalize} className="flex-1 rounded-xl bg-green py-3 text-[15px] font-extrabold text-black disabled:opacity-60">
            ✓ Guardar todo al stock
          </button>
        ) : (
          <div className="flex-1 rounded-xl border border-dashed border-br2 bg-s2 py-3 text-center text-[13px] text-muted">Escanea un producto para comenzar</div>
        )}
      </div>
    </div>
  )
}
