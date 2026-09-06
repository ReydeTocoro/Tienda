import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '../db/repositories/settings'
import { Modal } from '../shared/components/Modal'
import { toast } from '../store/useToastStore'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function Header() {
  const settings = useLiveQuery(() => getSettings())
  const now = useClock()
  const [editOpen, setEditOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  function openEdit() {
    setNameDraft(settings?.storeName ?? '')
    setEditOpen(true)
  }

  async function saveName() {
    const name = nameDraft.trim()
    if (!name) return
    await updateSettings({ storeName: name })
    setEditOpen(false)
    toast('✓ Nombre actualizado', 'lime')
  }

  async function toggleTheme() {
    const next = settings?.theme === 'light' ? 'dark' : 'light'
    await updateSettings({ theme: next })
    toast(next === 'light' ? '☀️ Modo claro' : '🌙 Modo oscuro', 'default')
  }

  return (
    <header className="z-50 flex flex-shrink-0 items-center justify-between border-b border-br bg-s1 px-4 py-2.5 lg:px-6 lg:py-3">
      <button onClick={openEdit} className="text-left transition-opacity hover:opacity-80" title="Clic para cambiar el nombre">
        <h1 className="font-display text-[17px] font-black text-lime lg:text-[19px]">🏪 {settings?.storeName ?? 'Mi Tienda Pro'}</h1>
        <div className="mt-px text-[9px] uppercase tracking-widest text-muted">Sistema de caja</div>
      </button>
      <div className="flex items-center gap-2.5 lg:gap-4">
        <button onClick={toggleTheme} title="Cambiar tema" className="text-[17px] leading-none opacity-70 transition-opacity hover:opacity-100">
          {settings?.theme === 'light' ? '☀️' : '🌙'}
        </button>
        <div className="text-right font-mono text-[11px] text-txt2">
          <div>{now.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          <div>{now.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} maxWidthClass="max-w-[320px]">
        <div className="mb-3 font-display text-[16px] font-bold">Nombre de tu tienda</div>
        <input
          className="input mb-3.5"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveName()}
          autoFocus
        />
        <div className="flex gap-2">
          <button onClick={() => setEditOpen(false)} className="flex-1 rounded-[10px] border border-br2 py-2 text-[13px] text-txt2">
            Cancelar
          </button>
          <button onClick={saveName} className="flex-1 rounded-[10px] bg-lime py-2 text-[13px] font-bold text-black">
            Guardar
          </button>
        </div>
      </Modal>
    </header>
  )
}
