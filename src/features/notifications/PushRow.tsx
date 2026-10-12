import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { toast } from '../../store/useToastStore'
import { PUSH_HOURS_LABEL } from './lib/notices'
import { disablePush, enablePush, isIosBrowser, pushState, type PushState } from './push'

/** Firebase's own errors come in English, with a `messaging/…` code. */
function reason(err: unknown): string {
  const code = (err as { code?: unknown })?.code
  if (typeof code === 'string' && code.startsWith('messaging/')) {
    console.error('Avisos al celular:', err)
    return 'No se pudieron activar los avisos en este equipo: revisa la conexión e inténtalo de nuevo'
  }
  return err instanceof Error ? err.message : 'No se pudieron activar los avisos en este equipo'
}

/** At the foot of "Pendientes de hoy", for the Administrador: getting these notices on this device at fixed hours,
 * even with the app closed (push.ts). */
export function PushRow() {
  const [state, setState] = useState<PushState>(pushState)
  const [busy, setBusy] = useState(false)

  if (state === 'unsupported') {
    return isIosBrowser() ? (
      <p className="mt-3 rounded-lg border border-br bg-s2 px-3 py-2 text-[12px] leading-snug text-txt2">
        Para recibir estos avisos en el iPhone, agrega la app a la pantalla de inicio (Safari → Compartir → Agregar a inicio) y actívalos desde ahí.
      </p>
    ) : null
  }

  async function run(work: () => Promise<string>) {
    setBusy(true)
    try {
      toast(await work(), 'green')
    } catch (err) {
      toast(reason(err), 'orange')
    } finally {
      setState(pushState())
      setBusy(false)
    }
  }
  const turnOn = () => run(async () => ((await enablePush()) ? 'Avisos activados: te enviamos uno de prueba' : 'Avisos activados en este equipo'))
  const turnOff = () => run(async () => (await disablePush(), 'Avisos desactivados en este equipo'))

  return (
    <div className="mt-3 flex items-center gap-3 rounded-lg border border-br bg-s2 px-3 py-2">
      <BellRing size={18} className={`flex-shrink-0 ${state === 'on' ? 'text-green' : 'text-muted'}`} />
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-txt2">
        {state === 'on'
          ? `Avisos al celular activados en este equipo: ${PUSH_HOURS_LABEL}`
          : state === 'blocked'
            ? 'Las notificaciones están bloqueadas para esta página: actívalas en los ajustes del navegador para recibir estos avisos.'
            : `Recibe estos pendientes en este equipo aunque la app esté cerrada: ${PUSH_HOURS_LABEL}`}
      </p>
      {state === 'off' && (
        <button onClick={() => void turnOn()} disabled={busy} className="flex-shrink-0 rounded-lg bg-lime px-3 py-1.5 text-[12px] font-semibold text-on-solid disabled:opacity-60">
          {busy ? 'Activando…' : 'Activar'}
        </button>
      )}
      {state === 'on' && (
        <button onClick={() => void turnOff()} disabled={busy} className="flex-shrink-0 rounded-lg border border-br2 bg-s1 px-3 py-1.5 text-[12px] font-semibold disabled:opacity-60">
          Desactivar
        </button>
      )}
    </div>
  )
}
