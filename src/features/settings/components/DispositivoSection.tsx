import { useEffect, useState, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { supabase } from '../../../api/supabase'
import { updateSettings } from '../../../db/repositories/settings'
import { useConfirm } from '../../../store/useConfirmStore'
import { useScannerStore } from '../../../store/useScannerStore'
import { toast } from '../../../store/useToastStore'
import { signOut } from '../../auth/session'
import { Card, Row, SectionHeader, Switch, dangerButton } from './ui'

const SHORTCUTS: Array<[string, string]> = [
  ['F1 – F6', 'Ir a Venta, Stock, Clientes, Fiados, Facturas o Reporte'],
  ['/  o  F7', 'Escribir en el buscador de productos de Venta'],
  ['F8', 'Activar o desactivar el lector de códigos'],
  ['0 – 9', 'Escribir el PIN cuando se pide'],
  ['Esc', 'Cerrar la ventana del PIN'],
]

/** What belongs to this device rather than to the store: the barcode reader, the keyboard
 * shortcuts and the store account signed in here. */
export function DispositivoSection() {
  const scannerEnabled = useScannerStore((s) => s.enabled)
  const setScannerEnabled = useScannerStore((s) => s.setEnabled)
  const [email, setEmail] = useState<string>()
  const confirm = useConfirm()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email))
  }, [])

  async function toggleScanner(next: boolean) {
    setScannerEnabled(next)
    toast(next ? 'Lector activado' : 'Lector desactivado', next ? 'lime' : 'muted')
    try {
      await updateSettings({ hidScannerEnabled: next })
    } catch {
      // The switch already works on this device; remembering it for the next session is best-effort.
    }
  }

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Cerrar la cuenta en este dispositivo',
      message: 'Este dispositivo dejará de mostrar la tienda hasta que alguien vuelva a iniciar sesión con el correo y la contraseña. Los datos siguen guardados en la nube.',
      confirmLabel: 'Cerrar sesión',
      danger: true,
    })
    if (ok) await signOut()
  }

  return (
    <>
      <SectionHeader title="Este dispositivo" description="Lo que solo afecta a este computador o celular." />

      <Card title="Lector de códigos de barras">
        <Row label="Lector conectado por USB" hint={scannerEnabled ? 'Activo: lo que escanees entra al buscador de Venta o de Stock.' : 'Desactivado: los escaneos se ignoran.'}>
          <Switch checked={scannerEnabled} onChange={toggleScanner} label="Lector de códigos de barras" />
        </Row>
      </Card>

      <Card title="Atajos de teclado">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys} className="flex items-center gap-4 px-4 py-2.5 md:px-5">
            <Kbd>{keys}</Kbd>
            <span className="text-[13px] text-txt2">{what}</span>
          </div>
        ))}
      </Card>

      <Card title="Cuenta de la tienda" description="Con ella se abrió la tienda en este dispositivo. Es distinta de los usuarios y sus PIN.">
        <Row label="Conectado como" hint={email ?? '…'}>
          <button type="button" onClick={handleSignOut} className={`${dangerButton} flex items-center gap-1.5`}>
            <LogOut size={15} />
            Cerrar sesión
          </button>
        </Row>
      </Card>
    </>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="min-w-[78px] whitespace-nowrap rounded-[6px] border border-br2 bg-s2 px-2 py-1 text-center font-mono text-[11px] font-bold">{children}</kbd>
}
