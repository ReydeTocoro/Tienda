import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useScannerStore } from '../../store/useScannerStore'
import { usePinStore } from '../../store/usePinStore'
import { toast } from '../../store/useToastStore'

const FMAP: Record<string, string> = { F1: '/', F2: '/inventario', F3: '/clientes', F4: '/fiados', F5: '/historial', F6: '/reporte' }

/** Global keyboard shortcuts — legacy's desktop shortcut handler (index.html L2284-2349):
 * F1-F6 navigate, F7/`/` focuses the Venta search bar, F8 toggles the HID scanner. */
export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (usePinStore.getState().request) return // the PIN modal owns keydown while open

      const tag = (e.target as HTMLElement)?.tagName
      const isField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (isField) return

      if (FMAP[e.key]) {
        e.preventDefault()
        navigate(FMAP[e.key])
        return
      }

      if ((e.key === '/' || e.key === 'F7') && location.pathname === '/') {
        e.preventDefault()
        document.getElementById('venta-search-input')?.focus()
        return
      }

      if (e.key === 'F8') {
        e.preventDefault()
        useScannerStore.getState().toggle()
        const enabled = useScannerStore.getState().enabled
        toast(enabled ? '📡 Lector activado' : '🔇 Lector desactivado', enabled ? 'lime' : 'muted')
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, location.pathname])
}
