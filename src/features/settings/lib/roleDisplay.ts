import { ADMIN_ROLE_ID, CAJERO_ROLE_ID, SUPERVISOR_ROLE_ID, type Permission, type Role } from '../../../shared/lib/permissions'

export type RoleTone = 'lime' | 'purple' | 'blue' | 'green' | 'orange'

/** One color per role, the same everywhere in Configuración (avatars, pills, role cards). Red is
 * kept for alerts, so custom roles alternate green and orange. */
export function roleTone(roles: Role[], roleId: string): RoleTone {
  if (roleId === ADMIN_ROLE_ID) return 'lime'
  if (roleId === SUPERVISOR_ROLE_ID) return 'purple'
  if (roleId === CAJERO_ROLE_ID) return 'blue'
  const custom = roles.filter((r) => ![ADMIN_ROLE_ID, SUPERVISOR_ROLE_ID, CAJERO_ROLE_ID].includes(r.id))
  return custom.findIndex((r) => r.id === roleId) % 2 === 0 ? 'green' : 'orange'
}

export const TONE_AVATAR: Record<RoleTone, string> = {
  lime: 'bg-lime/15 text-lime',
  purple: 'bg-purple/15 text-purple',
  blue: 'bg-blue/15 text-blue',
  green: 'bg-green/15 text-green',
  orange: 'bg-orange/15 text-orange',
}

/** What a role is for, in a line — under the built-in ones' names. */
export const ROLE_PURPOSE: Record<string, string> = {
  [ADMIN_ROLE_ID]: 'Acceso total. Es el único que entra a Configuración.',
  [SUPERVISOR_ROLE_ID]: 'Maneja la tienda cuando el dueño no está: stock, correcciones y cierre.',
  [CAJERO_ROLE_ID]: 'Vende y atiende clientes. No ve costos, ganancias ni totales.',
}

const AREAS: Array<{ perm: Permission; label: string }> = [
  { perm: 'stock.ver', label: 'Stock' },
  { perm: 'clientes.ver', label: 'Clientes' },
  { perm: 'fiados.ver', label: 'Fiados' },
  { perm: 'facturas.ver', label: 'Facturas' },
  { perm: 'caja.gestionar', label: 'Cajas' },
  { perm: 'proveedores.gestionar', label: 'Proveedores' },
  { perm: 'reportes.ver', label: 'Reportes' },
]

/** "Venta, Clientes, Facturas · no ve costos ni ganancias" — enough to pick a role from a list. */
export function roleSummary(role: Role): string {
  if (role.id === ADMIN_ROLE_ID) return 'Todo, incluida la configuración'
  const has = new Set(role.permissions)
  const areas = ['Venta', ...AREAS.filter((a) => has.has(a.perm)).map((a) => a.label)]
  const costs = has.has('costos.ver')
  const profit = has.has('ganancias.ver')
  const sees = costs && profit ? 've costos y ganancias' : costs ? 've costos, no ganancias' : profit ? 've ganancias, no costos' : 'no ve costos ni ganancias'
  return `${areas.join(', ')} · ${sees}`
}
