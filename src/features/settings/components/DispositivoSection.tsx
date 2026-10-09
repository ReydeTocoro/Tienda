import type { ReactNode } from 'react'
import { LogOut, Users } from 'lucide-react'
import { updateSettings } from '../../../db/repositories/settings'
import { useConfirm } from '../../../store/useConfirmStore'
import { useScannerStore } from '../../../store/useScannerStore'
import { toast } from '../../../store/useToastStore'
import { signOut } from '../../auth/session'
import { useAccountEmail } from '../../auth/useAccountEmail'
import { useChangeUser } from '../../auth/useChangeUser'
import { Card, Row, SectionHeader, Switch, dangerButton, secondaryButton } from './ui'

const SHORTCUTS: Array<[string, string]> = [
  ['F1 – F6', 'Ir a Venta, Stock, Clientes, Fiados, Facturas o Reporte'],
  ['/  o  F7', 'Escribir en el buscador de productos de Venta'],
  ['F8', 'Activar o desactivar el lector de códigos'],
  ['0 – 9', 'Escribir el PIN cuando se pide una autorización'],
  ['Esc', 'Cerrar la ventana del PIN'],
]

/** What belongs to this device rather than to the store: the barcode reader, the keyboard
 * shortcuts and the account signed in here. */
export function DispositivoSection() {
  const scannerEnabled = useScannerStore((s) => s.enabled)
  const setScannerEnabled = useScannerStore((s) => s.setEnabled)
  const email = useAccountEmail()
  const changeUser = useChangeUser()
  const confirm = useConfirm()

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
      title: 'Dejar de usar este dispositivo',
      message: 'Se cierra tu sesión y se borra la copia de los datos de la tienda que guarda este equipo. Los datos siguen en la nube: quien vuelva a entrar aquí los descarga de nuevo.',
      confirmLabel: 'Cerrar sesión y borrar',
      danger: true,
    })
    if (!ok) return
    try {
      await signOut({ forget: true })
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
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

      <Card title="Tu cuenta" description="Con ella entraste en este dispositivo.">
        <Row label="Conectado como" hint={email ?? '…'}>
          <button type="button" onClick={() => void changeUser()} className={`${secondaryButton} flex items-center gap-1.5`}>
            <Users size={15} />
            Cambiar de usuario
          </button>
        </Row>
        <Row label="Dejar de usar este dispositivo" hint="Cierra la sesión y borra la copia de los datos guardada en este equipo.">
          <button type="button" onClick={handleSignOut} className={`${dangerButton} flex items-center gap-1.5`}>
            <LogOut size={15} />
            Cerrar sesión y borrar
          </button>
        </Row>
      </Card>
    </>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="min-w-[78px] whitespace-nowrap rounded-[6px] border border-br2 bg-s2 px-2 py-1 text-center font-mono text-[11px] font-bold">{children}</kbd>
}
