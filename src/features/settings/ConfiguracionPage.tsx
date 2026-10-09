import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Lock, MonitorSmartphone, ShieldCheck, Store, Users } from 'lucide-react'
import { useConfirm } from '../../store/useConfirmStore'
import { useSecurityInfo } from './lib/useSecurityInfo'
import { NegocioSection } from './components/NegocioSection'
import { UsuariosSection } from './components/UsuariosSection'
import { RolesSection } from './components/RolesSection'
import { SeguridadSection } from './components/SeguridadSection'
import { DispositivoSection } from './components/DispositivoSection'

const SECTIONS = [
  { id: 'negocio', label: 'Negocio', hint: 'Nombre y datos del recibo', icon: Store },
  { id: 'usuarios', label: 'Usuarios', hint: 'Quién trabaja en la tienda', icon: Users },
  { id: 'roles', label: 'Roles y permisos', hint: 'Qué ve y hace cada uno', icon: ShieldCheck },
  { id: 'seguridad', label: 'Seguridad', hint: 'Sesiones y PIN maestro', icon: Lock },
  { id: 'dispositivo', label: 'Este dispositivo', hint: 'Lector, atajos y cuenta', icon: MonitorSmartphone },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

/** Configuración — only the Administrador gets here (see navConfig). One section at a time, picked
 * from a side menu (a scrolling strip on a phone); the section lives in the URL (`?seccion=`), so a
 * reload or a link lands on it. Unsaved role edits ask before leaving their section. */
export function ConfiguracionPage() {
  const [params, setParams] = useSearchParams()
  const current: SectionId = SECTIONS.find((s) => s.id === params.get('seccion'))?.id ?? 'negocio'
  const [rolesDirty, setRolesDirty] = useState(false)
  const confirm = useConfirm()
  // Asked to the server: no device can read the PINs (the master PIN still being "1234" included),
  // nor which accounts are the owner's.
  const security = useSecurityInfo()
  const defaultPin = !!security?.ownerPinDefault

  async function go(id: SectionId) {
    if (id === current) return
    if (rolesDirty) {
      const ok = await confirm({ title: 'Cambios sin guardar', message: 'Hiciste cambios en los roles que no has guardado. Si sales de esta sección se pierden.', confirmLabel: 'Salir sin guardar', danger: true })
      if (!ok) return
      setRolesDirty(false)
    }
    setParams({ seccion: id }, { replace: true })
  }

  return (
    <div className="p-3.5 md:mx-auto md:max-w-[1280px] md:p-6">
      <header className="mb-4 md:mb-5">
        <h1 className="font-display text-[22px] font-bold leading-tight md:text-[26px]">Configuración</h1>
        <p className="mt-1 text-[13px] text-txt2">Tu negocio, las personas que trabajan en él y lo que cada una puede ver y hacer.</p>
      </header>

      {defaultPin && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-red/30 bg-red/10 px-4 py-3">
          <AlertTriangle size={18} className="flex-shrink-0 text-red" />
          <p className="min-w-0 flex-1 text-[13px] text-txt">
            <b className="text-red">El PIN maestro sigue siendo 1234.</b> Cualquiera lo conoce, así que no sirve para autorizar nada hasta que lo cambies.
          </p>
          {current !== 'seguridad' && (
            <button onClick={() => go('seguridad')} className="rounded-[10px] bg-red px-3.5 py-1.5 text-[12px] font-bold text-on-solid">
              Cambiar PIN
            </button>
          )}
        </div>
      )}

      <div className="md:grid md:grid-cols-[220px_minmax(0,1fr)] md:items-start md:gap-6">
        <nav aria-label="Secciones de configuración" className="-mx-3.5 mb-4 flex gap-1.5 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none] md:sticky md:top-0 md:mx-0 md:mb-0 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0">
          {SECTIONS.map(({ id, label, hint, icon: Icon }) => {
            const active = current === id
            return (
              <button
                key={id}
                onClick={() => go(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors md:w-full md:py-2.5 ${
                  active ? 'border-lime/30 bg-lime/10 text-lime' : 'border-transparent text-txt2 hover:bg-s1 hover:text-txt md:hover:border-br'
                }`}
              >
                <Icon size={17} className="flex-shrink-0" />
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-[13px] font-semibold">{label}</span>
                  <span className={`hidden truncate text-[11px] md:block ${active ? 'text-lime/80' : 'text-muted'}`}>{hint}</span>
                </span>
              </button>
            )
          })}
        </nav>

        <div className="min-w-0">
          {current === 'negocio' && <NegocioSection />}
          {current === 'usuarios' && <UsuariosSection onGoTo={go} security={security} />}
          {current === 'roles' && <RolesSection onDirtyChange={setRolesDirty} />}
          {current === 'seguridad' && <SeguridadSection security={security} />}
          {current === 'dispositivo' && <DispositivoSection />}
        </div>
      </div>
    </div>
  )
}
