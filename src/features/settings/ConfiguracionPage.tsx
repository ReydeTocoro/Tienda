import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '../../db/repositories/settings'
import { sha256, WEAK_PINS } from '../../shared/lib/pin'
import { usePinGate } from '../pin/usePinGate'
import { useScannerStore } from '../../store/useScannerStore'
import { toast } from '../../store/useToastStore'
import { formatDateTime } from '../../shared/lib/currency'
import { UsuariosSection } from './components/UsuariosSection'
import { SessionSection } from '../auth/SessionSection'

/** Dedicated settings hub — PIN security, barcode scanner, and keyboard shortcuts. Split out of
 * the Reporte page (which used to mix cash-register reports with device/security config) so
 * each page has a single, clear purpose. */
export function ConfiguracionPage() {
  const settings = useLiveQuery(() => getSettings())
  const { isLocked, remainingSecs } = usePinGate()
  const scannerEnabled = useScannerStore((s) => s.enabled)
  const setScannerEnabled = useScannerStore((s) => s.setEnabled)

  const [pinLength, setPinLength] = useState<4 | 6>(4)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null)
  const lengthHydrated = useRef(false)

  const [storeName, setStoreName] = useState('')
  const nameHydrated = useRef(false)

  useEffect(() => {
    if (!lengthHydrated.current && settings) {
      setPinLength(settings.pinLength)
      lengthHydrated.current = true
    }
    if (!nameHydrated.current && settings) {
      setStoreName(settings.storeName)
      nameHydrated.current = true
    }
  }, [settings])

  async function saveStoreName() {
    const name = storeName.trim()
    if (!name) return
    await updateSettings({ storeName: name })
    toast('Nombre de la tienda actualizado', 'lime')
  }

  async function savePin() {
    const re = new RegExp(`^\\d{${pinLength}}$`)
    if (!re.test(pin)) {
      setStatus({ text: `El PIN debe tener exactamente ${pinLength} dígitos numéricos`, ok: false })
      return
    }
    if (pin !== pinConfirm) {
      setStatus({ text: 'Los PINs no coinciden', ok: false })
      return
    }
    if (WEAK_PINS.has(pin)) {
      setStatus({ text: 'PIN demasiado predecible — elige uno más seguro', ok: false })
      return
    }
    const pinHash = await sha256(pin)
    await updateSettings({ pinHash, pinLength, pinChangedAt: new Date().toISOString() })
    setPin('')
    setPinConfirm('')
    setStatus({ text: 'PIN guardado y cifrado correctamente', ok: true })
    toast('PIN actualizado con seguridad', 'lime')
  }

  async function toggleScanner() {
    const next = !scannerEnabled
    setScannerEnabled(next)
    await updateSettings({ hidScannerEnabled: next })
    toast(next ? 'Lector activado' : 'Lector desactivado', next ? 'lime' : 'muted')
  }

  return (
    <div className="p-3.5 md:mx-auto md:max-w-[1200px] md:p-6">
      <p className="mb-3.5 font-display text-[21px] font-bold md:text-[26px]">Configuración</p>

      <p className="mb-2 field-label">Nombre de la tienda</p>
      <div className="mb-1.5 flex gap-2 rounded-xl border border-br bg-s1 p-3.5 shadow-xs md:max-w-md">
        <input
          className="input"
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveStoreName()}
          placeholder="Mi Tienda Pro"
        />
        <button onClick={saveStoreName} className="flex-shrink-0 rounded-[10px] bg-lime px-4 py-2 text-[13px] font-bold text-on-solid transition-opacity hover:opacity-90">
          Guardar
        </button>
      </div>
      <p className="mb-3.5 text-[11px] text-muted md:max-w-md">Sale en los recibos, el Reporte X y los archivos que exportas. En la barra de arriba se muestra el logo.</p>

      <div className="md:grid md:grid-cols-2 md:items-start md:gap-6">
        <div>
          <p className="mb-2 field-label">Seguridad — PIN</p>
          <div className="mb-3.5 rounded-xl border border-br bg-s1 p-3.5 shadow-xs">
            <div className="mb-3 text-[13px] text-txt2">
              El PIN protege: agregar/quitar stock, cierre de caja, pago de fiados y corrección de facturas. Máximo <b className="text-red">5 intentos</b> antes de bloqueo temporal.
            </div>

            {isLocked && (
              <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-red/30 bg-red/10 px-3 py-2.5 text-[12px] font-semibold text-red">
                PIN bloqueado — persiste incluso si recargas la página
                <span className="ml-auto font-mono text-[14px] font-extrabold">{remainingSecs}s</span>
              </div>
            )}

            <div className="mb-3.5 flex items-center gap-2">
              <div className="flex-shrink-0 field-label">Longitud:</div>
              <div className="flex gap-1.5">
                {[4, 6].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPinLength(n as 4 | 6)}
                    className={`rounded-lg border px-3 py-1 font-mono text-[12px] font-bold transition-colors ${pinLength === n ? 'border-lime bg-lime/15 text-lime' : 'border-br2 text-txt2 hover:bg-s3'}`}
                  >
                    {n} dígitos
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-2.5 grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1.5 field-label">Nuevo PIN</div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={pinLength}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="input border-lime text-center font-mono text-[18px] tracking-[6px]"
                  placeholder={'•'.repeat(pinLength)}
                />
              </div>
              <div>
                <div className="mb-1.5 field-label">Confirmar PIN</div>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={pinLength}
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))}
                  className="input text-center font-mono text-[18px] tracking-[6px]"
                  placeholder={'•'.repeat(pinLength)}
                />
              </div>
            </div>

            <button onClick={savePin} className="mt-1 w-full rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid transition-opacity hover:opacity-90">
              Guardar PIN
            </button>
            {status && <div className={`mt-1.5 text-center text-[11px] ${status.ok ? 'text-green' : 'text-red'}`}>{status.text}</div>}

            <div className="mt-3 rounded-lg bg-s3 p-2.5 text-[12px] leading-relaxed text-muted">
              PIN cifrado con <b className="text-txt2">SHA-256</b> en el dispositivo. Bloqueo automático tras <b className="text-red">5 intentos</b> fallidos (<b className="text-orange">30 seg</b>). PIN por defecto:{' '}
              <b className="font-mono text-lime">1234</b>
            </div>
            {settings?.pinChangedAt && <div className="mt-1.5 text-center text-[10px] text-muted">Último cambio: {formatDateTime(settings.pinChangedAt)}</div>}
          </div>
        </div>

        <div>
          <p className="mb-2 field-label">Lector de Código de Barras</p>
          <div className="mb-3.5 rounded-xl border border-br bg-s1 p-3.5 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-bold">Estado del lector</div>
                <div className={`mt-0.5 text-[11px] ${scannerEnabled ? 'text-lime' : 'text-muted'}`}>{scannerEnabled ? 'Activo — esperando escaneo' : 'Desactivado'}</div>
              </div>
              <button
                onClick={toggleScanner}
                className={`rounded-[10px] border px-4 py-2 text-[12px] font-bold transition-colors ${scannerEnabled ? 'border-lime/30 bg-lime/10 text-lime hover:bg-lime/20' : 'border-red/30 bg-red/10 text-red hover:bg-red/20'}`}
              >
                {scannerEnabled ? 'Desactivar' : 'Activar'}
              </button>
            </div>
            <div className="rounded-lg bg-s3 p-2.5 text-[12px] leading-relaxed text-muted">
              <kbd className="rounded border border-br2 bg-s1 px-1.5 py-0.5 font-mono text-[11px]">F8</kbd> activa / desactiva el lector desde cualquier página.
            </div>
          </div>

          <p className="mb-2 field-label">Atajos de Teclado</p>
          <div className="mb-3.5 rounded-xl border border-br bg-s1 p-3.5 shadow-xs text-[12px] leading-loose">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3.5 gap-y-1">
              <Kbd>F1–F6</Kbd>
              <span className="text-txt2">Navegar entre páginas (Venta, Stock, Clientes…)</span>
              <Kbd>/</Kbd>
              <span className="text-txt2">Enfocar buscador de productos en Venta</span>
              <Kbd>F7</Kbd>
              <span className="text-txt2">Enfocar buscador (alternativa)</span>
              <Kbd>F8</Kbd>
              <span className="text-txt2">Activar / desactivar lector de barras</span>
              <Kbd>Esc</Kbd>
              <span className="text-txt2">Cerrar el modal de PIN</span>
              <Kbd>0–9</Kbd>
              <span className="text-txt2">Ingresar PIN (cuando el modal está abierto)</span>
            </div>
          </div>
        </div>
      </div>

      <UsuariosSection />
      <SessionSection />
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="whitespace-nowrap rounded-[5px] border border-br2 bg-s3 px-2 py-0.5 font-mono text-[11px] font-bold">{children}</kbd>
}
