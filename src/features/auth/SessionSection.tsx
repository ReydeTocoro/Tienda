import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { supabase } from '../../api/supabase'
import { useConfirm } from '../../store/useConfirmStore'
import { signOut } from './session'

/** Configuración's "who is signed in here" card, with the way out. */
export function SessionSection() {
  const [email, setEmail] = useState<string>()
  const confirm = useConfirm()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email))
  }, [])

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: 'Este dispositivo dejará de mostrar la tienda hasta que alguien vuelva a iniciar sesión. Los datos siguen guardados en la nube.',
      confirmLabel: 'Cerrar sesión',
      danger: true,
    })
    if (ok) await signOut()
  }

  return (
    <div className="mt-3.5">
      <p className="mb-2 field-label">Sesión en este dispositivo</p>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-br bg-s1 p-3.5 shadow-xs">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">Conectado como</div>
          <div className="truncate text-[12px] text-txt2">{email ?? '…'}</div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 rounded-[10px] border border-red/30 bg-red/10 px-3.5 py-2 text-[12px] font-bold text-red transition-colors hover:bg-red/15"
        >
          <LogOut size={15} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
