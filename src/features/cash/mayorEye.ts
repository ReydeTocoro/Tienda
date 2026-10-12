import { usePinStore } from '../../store/usePinStore'
import { useMayorStore } from '../../store/useMayorStore'
import { counterApprove } from '../pin/counterSession'

/** What a locked Caja Mayor says when something asks for it. */
export const MAYOR_LOCKED = 'La Caja Mayor está cerrada: abre el ojito de su tarjeta en Cajas (pide el PIN) para hacer esto'

/** What the figures of a closed Caja Mayor look like. */
export const MAYOR_MASK = '••••••'

/** Opens the Caja Mayor: asks for a PIN every time — of whoever may manage the cajas (`caja.gestionar`), the person working or
 * someone else —, which the server checks. Resolves true when it is open. */
export async function openMayor(): Promise<boolean> {
  if (useMayorStore.getState().open) return true
  const result = await usePinStore.getState().ask('Abrir la Caja Mayor', 'Escribe tu PIN para ver y mover la Caja Mayor.', (pin) => counterApprove(pin, 'caja.gestionar'))
  if (!result.ok) return false
  useMayorStore.getState().setOpen(true)
  return true
}

export const closeMayor = (): void => useMayorStore.getState().setOpen(false)
