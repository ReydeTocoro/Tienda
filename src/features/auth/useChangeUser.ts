import { useConfirm } from '../../store/useConfirmStore'
import { useSessionStore } from '../../store/useSessionStore'
import { toast } from '../../store/useToastStore'
import { signOut } from './session'

/** "Cambiar de usuario": after a confirmation, the person working here signs out and the login
 * shows for the next one, who enters with their own email and password. */
export function useChangeUser(): () => Promise<void> {
  const confirm = useConfirm()
  return async () => {
    const name = useSessionStore.getState().operator?.name
    const ok = await confirm({
      title: 'Cambiar de usuario',
      message: `Se cerrará la sesión${name ? ` de ${name}` : ''} en este equipo. La siguiente persona entra con su correo y su contraseña.`,
      confirmLabel: 'Cerrar sesión',
    })
    if (!ok) return
    try {
      await signOut()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }
}
