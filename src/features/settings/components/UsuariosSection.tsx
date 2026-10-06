import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Crown, Pencil, UserPlus } from 'lucide-react'
import { db } from '../../../db/index'
import { getSettings } from '../../../db/repositories/settings'
import { updateUsuario } from '../../../db/repositories/usuarios'
import { findRole } from '../../../shared/lib/permissions'
import { initials } from '../../../shared/lib/text'
import type { Usuario } from '../../../types/usuario'
import { OWNER_ID } from '../../../store/useSessionStore'
import { toast } from '../../../store/useToastStore'
import { usePermission } from '../../pin/usePermission'
import { roleTone, TONE_AVATAR } from '../lib/roleDisplay'
import type { SectionId } from '../ConfiguracionPage'
import { UsuarioFormSheet } from './UsuarioFormSheet'
import type { SecurityInfo } from '../lib/useSecurityInfo'
import { Card, Pill, SectionHeader, Switch, primaryButton, secondaryButton } from './ui'

/** The team: the owner (master PIN, always Administrador) first, then every user with their role,
 * status and anything that needs attention (a shared PIN, a PIN of the wrong length, a deleted
 * role). Activate/deactivate right from the list; everything else in the user's sheet. */
export function UsuariosSection({ onGoTo, security }: { onGoTo: (id: SectionId) => void; security: SecurityInfo | null }) {
  const usuarios = useLiveQuery(() => db.usuarios.toArray(), [], [] as Usuario[])
  const settings = useLiveQuery(() => getSettings())
  const { roles, access, operator } = usePermission()
  const [sheet, setSheet] = useState<{ user: Usuario | null; key: number } | null>(null)
  const pinLength = settings?.pinLength ?? 4

  const sorted = useMemo(() => [...usuarios].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es')), [usuarios])
  // PINs used by more than one person (the owner's master PIN counts): a PIN must say who signs in.
  // Only the server can tell — it alone holds the PINs, hashed.
  const sharedPins = useMemo(() => new Set(security?.sharedPinUserIds ?? []), [security])
  const activeCount = usuarios.filter((u) => u.active).length
  const counterRole = findRole(roles, access.counterRole)

  async function toggleActive(u: Usuario) {
    try {
      await updateUsuario(u.id, { name: u.name, role: u.role, active: !u.active })
      toast(u.active ? `${u.name} ya no puede ingresar` : `${u.name} puede ingresar de nuevo`, u.active ? 'muted' : 'green')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    }
  }

  return (
    <>
      <SectionHeader
        title="Usuarios"
        description="Cada persona entra con su propio PIN, y su rol decide qué ve y qué puede hacer. Las ventas y los cierres quedan a su nombre."
        action={
          <button type="button" className={`${primaryButton} flex items-center gap-1.5`} onClick={() => setSheet({ user: null, key: Date.now() })}>
            <UserPlus size={15} />
            Agregar usuario
          </button>
        }
      />

      {access.mode === 'abierto' && activeCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-blue/25 bg-blue/10 px-4 py-3 text-[13px]">
          <p className="min-w-0 flex-1 text-txt">
            El mostrador está en <b>modo abierto</b>: quien no ingresa trabaja como <b>{counterRole?.name ?? 'Cajero'}</b>. Para que cada venta quede a nombre de quien la hace, pide el PIN a cada persona.
          </p>
          <button type="button" onClick={() => onGoTo('seguridad')} className={secondaryButton}>
            Ir a Seguridad
          </button>
        </div>
      )}

      <Card>
        <div className="flex items-center gap-3 px-4 py-3 md:px-5">
          <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${TONE_AVATAR.lime}`}>
            <Crown size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[14px] font-bold">Propietario</span>
              {operator?.id === OWNER_ID && <span className="text-[11px] text-muted">(tú)</span>}
              <Pill tone="lime">Administrador</Pill>
              {security?.ownerSharesPin && <Warning text="PIN repetido" />}
            </div>
            <div className="mt-0.5 text-[12px] text-muted">Entra con el PIN maestro. Siempre tiene acceso total.</div>
          </div>
          <button type="button" onClick={() => onGoTo('seguridad')} className={`${secondaryButton} flex-shrink-0 px-3 py-1.5 text-[12px]`}>
            Cambiar PIN
          </button>
        </div>

        {sorted.map((u) => {
          const role = findRole(roles, u.role)
          const tone = roleTone(roles, u.role)
          return (
            <div key={u.id} className={`flex items-center gap-3 px-4 py-3 md:px-5 ${u.active ? '' : 'bg-s2/60'}`}>
              <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${u.active ? TONE_AVATAR[tone] : 'bg-s3 text-muted'}`}>{initials(u.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`truncate text-[14px] font-bold ${u.active ? '' : 'text-muted'}`}>{u.name}</span>
                  {operator?.id === u.id && <span className="text-[11px] text-muted">(tú)</span>}
                  {role ? <Pill tone={tone}>{role.name}</Pill> : <Warning text="Su rol ya no existe" />}
                  {!u.active && <Pill>Inactivo</Pill>}
                  {sharedPins.has(u.id) && <Warning text="PIN repetido" />}
                  {u.pinLength !== undefined && u.pinLength !== pinLength && <Warning text={`PIN de ${u.pinLength} dígitos: dale uno de ${pinLength}`} />}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">{u.active ? 'Puede ingresar con su PIN' : 'No puede ingresar'}</div>
              </div>
              <Switch checked={u.active} onChange={() => toggleActive(u)} label={`${u.name}: ${u.active ? 'activo' : 'inactivo'}`} />
              <button
                type="button"
                onClick={() => setSheet({ user: u, key: Date.now() })}
                aria-label={`Editar a ${u.name}`}
                title="Editar"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-br2 text-txt2 transition-colors hover:border-lime/40 hover:text-lime"
              >
                <Pencil size={14} />
              </button>
            </div>
          )
        })}

        {!usuarios.length && (
          <div className="px-4 py-8 text-center md:px-5">
            <p className="text-[14px] font-semibold">Aún no hay usuarios</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted">
              Crea uno por cada persona que te ayuda en la tienda. Así cada venta queda a su nombre y solo ve lo que su rol le permite.
            </p>
            <button type="button" className={`${primaryButton} mt-3`} onClick={() => setSheet({ user: null, key: Date.now() })}>
              Crear el primer usuario
            </button>
          </div>
        )}
      </Card>

      <p className="text-[12px] text-muted">
        {activeCount} usuario{activeCount !== 1 ? 's' : ''} activo{activeCount !== 1 ? 's' : ''}
        {usuarios.length > activeCount ? ` · ${usuarios.length - activeCount} inactivo${usuarios.length - activeCount !== 1 ? 's' : ''}` : ''} · los PIN son de {pinLength} dígitos
      </p>

      <UsuarioFormSheet key={sheet?.key} open={!!sheet} user={sheet?.user ?? null} onClose={() => setSheet(null)} />
    </>
  )
}

function Warning({ text }: { text: string }) {
  return (
    <Pill tone="red">
      <AlertTriangle size={11} />
      {text}
    </Pill>
  )
}
