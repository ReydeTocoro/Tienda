/** Roles and permissions — the single source for what each person working at the store may see and
 * do. Pure (no React, no Dexie): the server checks every request, and computes the permissions the
 * database's RLS policies look up, with the exact same catalog the Configuración screen offers.
 *
 * - `Administrador` is built in, fixed and has every permission plus what no other role can be
 *   granted: Configuración, users, roles and security. The owner's master PIN always signs in as it,
 *   so the store can never be locked out by a bad role edit.
 * - `Supervisor` and `Cajero` are built in too (they can't be deleted) but their permissions are
 *   editable; custom roles can be added. The edited list lives in `settings.roles`. */

export type Permission =
  | 'ventas.fiar'
  | 'ventas.descuentos'
  | 'ventas.cambiarTotal'
  | 'ventas.productoLibre'
  | 'ventas.verTotales'
  | 'costos.ver'
  | 'ganancias.ver'
  | 'stock.ver'
  | 'stock.editar'
  | 'stock.ajustar'
  | 'stock.entradas'
  | 'stock.eliminar'
  | 'stock.importar'
  | 'clientes.ver'
  | 'clientes.editar'
  | 'fiados.ver'
  | 'fiados.abonar'
  | 'fiados.condonar'
  | 'facturas.ver'
  | 'facturas.corregir'
  | 'caja.abrir'
  | 'caja.cerrar'
  | 'caja.verEsperado'
  | 'caja.gestionar'
  | 'proveedores.gestionar'
  | 'reportes.ver'

/** A permission, or 'admin' for what only the Administrador role may do (Configuración, users,
 * roles, security). */
export type Need = Permission | 'admin'

export interface PermissionDef {
  key: Permission
  label: string
  /** One plain sentence on what it unlocks, shown under the checkbox. */
  hint: string
  /** Granting this one grants these too (and revoking any of them revokes this). */
  requires?: Permission[]
}

export interface PermissionGroup {
  label: string
  permissions: PermissionDef[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: 'Ventas',
    permissions: [
      { key: 'ventas.fiar', label: 'Vender fiado', hint: 'Elegir "Fiado" como forma de pago al cobrar.' },
      { key: 'ventas.descuentos', label: 'Aplicar descuentos', hint: 'Dar un descuento manual (%) a la venta.' },
      { key: 'ventas.cambiarTotal', label: 'Cambiar el total a cobrar', hint: 'Redondear o ajustar el total en el cobro.' },
      { key: 'ventas.productoLibre', label: 'Vender productos sin registrar', hint: 'Cobrar algo que no está en el inventario, con precio libre.' },
      {
        key: 'ventas.verTotales',
        label: 'Ver cuánto se ha vendido',
        hint: 'Ventas del día y ticket promedio en la pantalla de Venta. Quien entra a Facturas igual ve cada venta por separado.',
      },
    ],
  },
  {
    label: 'Costos y ganancias',
    permissions: [
      {
        key: 'costos.ver',
        label: 'Ver precios de compra',
        hint: 'A cómo se compra cada producto y su margen: en Stock, en el formulario del producto y en las facturas de compra. Sin este permiso, el sistema no le envía esos datos a su pantalla.',
      },
      {
        key: 'ganancias.ver',
        label: 'Ver ganancias y valor del inventario',
        hint: 'Cuánto vale el inventario, la ganancia del día y el margen en Venta, Reporte y cierres.',
        requires: ['costos.ver'],
      },
    ],
  },
  {
    label: 'Inventario (Stock)',
    permissions: [
      { key: 'stock.ver', label: 'Entrar a Stock', hint: 'Ver los productos, sus existencias y precios de venta.' },
      { key: 'stock.editar', label: 'Crear y editar productos', hint: 'Agregar productos y cambiar nombres, categorías y precios de venta.', requires: ['stock.ver'] },
      { key: 'stock.ajustar', label: 'Ajustar existencias', hint: 'Sumar o restar unidades, conteo cíclico y abrir paquetes.', requires: ['stock.ver'] },
      { key: 'stock.entradas', label: 'Registrar entradas de mercancía', hint: 'Sumar al stock lo que llega del proveedor.', requires: ['stock.ver'] },
      { key: 'stock.eliminar', label: 'Eliminar productos', hint: 'Borrar un producto del inventario.', requires: ['stock.ver'] },
      {
        key: 'stock.importar',
        label: 'Importar y exportar el catálogo',
        hint: 'Archivos de Excel y CSV. Incluyen los precios de compra.',
        requires: ['stock.ver', 'costos.ver'],
      },
    ],
  },
  {
    label: 'Clientes y fiados',
    permissions: [
      { key: 'clientes.ver', label: 'Entrar a Clientes', hint: 'Ver la lista de clientes y su historial.' },
      { key: 'clientes.editar', label: 'Crear y editar clientes', hint: 'Registrar clientes nuevos y corregir sus datos.', requires: ['clientes.ver'] },
      { key: 'fiados.ver', label: 'Entrar a Fiados', hint: 'Ver quién debe y cuánto.' },
      { key: 'fiados.abonar', label: 'Recibir abonos y pagos', hint: 'Registrar lo que paga un cliente de su fiado.', requires: ['fiados.ver'] },
      { key: 'fiados.condonar', label: 'Condonar deudas', hint: 'Perdonar un fiado: se cierra sin que entre dinero.', requires: ['fiados.ver'] },
    ],
  },
  {
    label: 'Facturas',
    permissions: [
      { key: 'facturas.ver', label: 'Entrar a Facturas', hint: 'Buscar ventas anteriores y volver a imprimir el recibo.' },
      { key: 'facturas.corregir', label: 'Corregir facturas', hint: 'Cambiar productos o cantidades de una venta ya hecha.', requires: ['facturas.ver'] },
    ],
  },
  {
    label: 'Caja',
    permissions: [
      { key: 'caja.abrir', label: 'Abrir la caja', hint: 'Contar el efectivo al empezar el día.' },
      { key: 'caja.cerrar', label: 'Hacer el cierre de caja', hint: 'Contar el efectivo al terminar y cerrar el día (Cierre Z).' },
      {
        key: 'caja.verEsperado',
        label: 'Ver el efectivo esperado',
        hint: 'Cuánto debería haber en la caja. Sin este permiso se abre y se cierra a ciegas: se cuenta sin ver la cifra.',
      },
      {
        key: 'caja.gestionar',
        label: 'Entrar a Cajas',
        hint: 'Saldos de Caja Menor y Caja Mayor, gastos, ingresos y traslados.',
        requires: ['caja.abrir', 'caja.cerrar', 'caja.verEsperado'],
      },
    ],
  },
  {
    label: 'Proveedores y reportes',
    permissions: [
      { key: 'proveedores.gestionar', label: 'Entrar a Proveedores', hint: 'Pedidos, compras y cuentas por pagar. Incluye ver precios de compra.', requires: ['costos.ver'] },
      {
        key: 'reportes.ver',
        label: 'Ver reportes',
        hint: 'Reporte de caja, Reporte X e historial de cierres, con el efectivo de cada día.',
        requires: ['ventas.verTotales', 'caja.verEsperado'],
      },
    ],
  },
]

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key))
const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS)
const REQUIRES = new Map<Permission, Permission[]>(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p.requires ?? []] as const)))

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSION_SET.has(value)
}

export interface Role {
  id: string
  name: string
  permissions: Permission[]
}

export const ADMIN_ROLE_ID = 'admin'
export const SUPERVISOR_ROLE_ID = 'supervisor'
export const CAJERO_ROLE_ID = 'cajero'
/** Built-in roles: can't be deleted or renamed. Only the Administrador is also fixed. */
export const BUILT_IN_ROLE_IDS = new Set([ADMIN_ROLE_ID, SUPERVISOR_ROLE_ID, CAJERO_ROLE_ID])

export const ADMIN_ROLE: Role = { id: ADMIN_ROLE_ID, name: 'Administrador', permissions: ALL_PERMISSIONS }

/** The owner's master PIN always signs in as this "person", with the Administrador role. */
export const OWNER_ID = 'owner'
export const OWNER_NAME = 'Propietario'

/** What the two editable built-in roles start with. A Cajero sells and serves customers but sees no
 * costs, profits or sales totals, and opens/closes the caja only if allowed. A Supervisor runs the
 * store when the owner isn't there — stock, corrections, cierre — still without costs or profits. */
export const DEFAULT_ROLES: Role[] = [
  {
    id: SUPERVISOR_ROLE_ID,
    name: 'Supervisor',
    permissions: [
      'ventas.fiar',
      'ventas.descuentos',
      'ventas.cambiarTotal',
      'ventas.productoLibre',
      'ventas.verTotales',
      'stock.ver',
      'stock.editar',
      'stock.ajustar',
      'stock.entradas',
      'clientes.ver',
      'clientes.editar',
      'fiados.ver',
      'fiados.abonar',
      'facturas.ver',
      'facturas.corregir',
      'caja.abrir',
      'caja.cerrar',
      'caja.verEsperado',
      'caja.gestionar',
      'reportes.ver',
    ],
  },
  {
    id: CAJERO_ROLE_ID,
    name: 'Cajero',
    permissions: ['ventas.fiar', 'ventas.descuentos', 'ventas.cambiarTotal', 'ventas.productoLibre', 'clientes.ver', 'clientes.editar', 'fiados.ver', 'facturas.ver', 'caja.abrir'],
  },
]

/** Adds everything the given permissions require, transitively. */
export function withRequirements(perms: Iterable<Permission>): Set<Permission> {
  const out = new Set<Permission>()
  const stack = [...perms]
  while (stack.length) {
    const p = stack.pop()!
    if (out.has(p)) continue
    out.add(p)
    stack.push(...(REQUIRES.get(p) ?? []))
  }
  return out
}

/** Removes `perm` and everything that (transitively) requires it — unticking "Ver precios de
 * compra" also unticks "Entrar a Proveedores". */
export function withoutPermission(perms: Iterable<Permission>, perm: Permission): Set<Permission> {
  const out = new Set(perms)
  out.delete(perm)
  let changed = true
  while (changed) {
    changed = false
    for (const p of out) {
      if ((REQUIRES.get(p) ?? []).some((r) => !out.has(r))) {
        out.delete(p)
        changed = true
      }
    }
  }
  return out
}

/** Permissions this one requires, transitively — shown as "también activa: …" in the editor. */
export function requirementsOf(perm: Permission): Permission[] {
  const all = withRequirements([perm])
  all.delete(perm)
  return [...all]
}

export function permissionLabel(perm: Need): string {
  if (perm === 'admin') return 'Administrar la tienda'
  for (const g of PERMISSION_GROUPS) {
    const def = g.permissions.find((p) => p.key === perm)
    if (def) return def.label
  }
  return perm
}

export const MAX_ROLE_NAME = 30
export const MAX_ROLES = 20

/** Cleans a role list coming from storage or from a request: drops the Administrador (never
 * stored), unknown permissions and duplicate ids, closes every role over its requirements, fixes
 * built-in names, and puts back any built-in role that's missing (with its defaults). Never
 * throws — a stored list from an older version still yields a usable set of roles. */
export function sanitizeRoles(input: unknown): Role[] {
  const seen = new Set<string>()
  const out: Role[] = []
  for (const raw of Array.isArray(input) ? input : []) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Partial<Role>
    const id = typeof r.id === 'string' ? r.id.trim().slice(0, 40) : ''
    if (!id || id === ADMIN_ROLE_ID || seen.has(id)) continue
    const builtIn = DEFAULT_ROLES.find((d) => d.id === id)
    const name = builtIn ? builtIn.name : typeof r.name === 'string' ? r.name.trim().slice(0, MAX_ROLE_NAME) : ''
    if (!name) continue
    const perms = withRequirements((Array.isArray(r.permissions) ? r.permissions : []).filter(isPermission))
    seen.add(id)
    out.push({ id, name, permissions: ALL_PERMISSIONS.filter((p) => perms.has(p)) })
    if (out.length >= MAX_ROLES) break
  }
  for (const d of DEFAULT_ROLES) if (!seen.has(d.id)) out.push({ ...d, permissions: [...d.permissions] })
  // Built-ins first, in their usual order; custom roles after, as the owner created them.
  return [...DEFAULT_ROLES.map((d) => out.find((r) => r.id === d.id)!), ...out.filter((r) => !BUILT_IN_ROLE_IDS.has(r.id))]
}

/** Every role the store has: the fixed Administrador first, then the stored (or default) ones. */
export function resolveRoles(stored: unknown): Role[] {
  return [ADMIN_ROLE, ...sanitizeRoles(stored)]
}

export function findRole(roles: Role[], id: string | undefined | null): Role | undefined {
  return id ? roles.find((r) => r.id === id) : undefined
}

/** A role id that isn't in the list (deleted) grants nothing — the safe reading of a dangling id. */
export function roleCan(roles: Role[], roleId: string | undefined | null, perm: Permission): boolean {
  if (roleId === ADMIN_ROLE_ID) return true
  return !!findRole(roles, roleId)?.permissions.includes(perm)
}

/** Everything a role may do, as the server stores it for RLS: its permissions, plus 'admin' for the
 * Administrador. A role that doesn't exist may do nothing. */
export function needsOfRole(roles: Role[], roleId: string | undefined | null): Need[] {
  if (roleId === ADMIN_ROLE_ID) return [...ALL_PERMISSIONS, 'admin']
  return [...(findRole(roles, roleId)?.permissions ?? [])]
}

/** How the app is used at the counter — `settings.access`. */
export interface AccessSettings {
  /** 'abierto': the app opens straight into Venta with the counter role's permissions; anything
   * beyond them asks for the PIN of someone allowed. 'pin': everyone signs in with their own PIN
   * and the screen locks after inactivity. */
  mode: 'abierto' | 'pin'
  /** Role the open counter works with while nobody is signed in (mode 'abierto'). Never the Administrador. */
  counterRole: string
  /** Minutes without touching the screen before whoever signed in is signed out (0 = never). */
  autoLockMinutes: number
}

export const AUTO_LOCK_CHOICES = [0, 2, 5, 10, 15, 30, 60]

export const DEFAULT_ACCESS: AccessSettings = { mode: 'abierto', counterRole: CAJERO_ROLE_ID, autoLockMinutes: 5 }

/** Same idea as `sanitizeRoles`, for `settings.access`: unknown values fall back to the defaults,
 * and a counter role that doesn't exist (or is the Administrador) becomes the Cajero. */
export function sanitizeAccess(input: unknown, roles: Role[]): AccessSettings {
  const a = (input && typeof input === 'object' ? input : {}) as Partial<AccessSettings>
  const mode = a.mode === 'pin' ? 'pin' : 'abierto'
  const counterRole = typeof a.counterRole === 'string' && a.counterRole !== ADMIN_ROLE_ID && roles.some((r) => r.id === a.counterRole) ? a.counterRole : CAJERO_ROLE_ID
  const autoLockMinutes = AUTO_LOCK_CHOICES.includes(Number(a.autoLockMinutes)) ? Number(a.autoLockMinutes) : DEFAULT_ACCESS.autoLockMinutes
  return { mode, counterRole, autoLockMinutes }
}

/** A short, readable id for a new custom role ("Bodega" → "bodega", then "bodega-2"…). */
export function newRoleId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'rol'
  let id = BUILT_IN_ROLE_IDS.has(base) ? `${base}-2` : base
  for (let n = 2; used.has(id) || BUILT_IN_ROLE_IDS.has(id); n++) id = `${base}-${n}`
  return id
}
