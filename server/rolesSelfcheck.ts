/** Self-check for roles, permissions and users: the permission catalog and its requirements, how a
 * stored role list is cleaned, and the server rules on users and settings (Administrador only,
 * unique PIN and name, an existing role, no deleting a role someone has, PINs hashed where no browser
 * reads them) on an in-memory Postgres (PGlite) built from the real migrations — never the Supabase
 * data:  npm run check:roles */
import assert from 'node:assert/strict'
import { pgliteDb } from './db'
import { testDatabase } from './testDb'
import { changeOwnerPin, sha256, type Actor } from './domain/counter'
import { applySettingsPatch, createUsuario, deleteUsuario, updateUsuario } from './domain/users'
import { getRow, listAll } from './routes/generic'
import { HttpError } from './routes/http'
import {
  ADMIN_ROLE_ID,
  ALL_PERMISSIONS,
  CAJERO_ROLE_ID,
  DEFAULT_ACCESS,
  DEFAULT_ROLES,
  MAX_ROLES,
  OWNER_ID,
  OWNER_NAME,
  PERMISSION_GROUPS,
  SUPERVISOR_ROLE_ID,
  needsOfRole,
  newRoleId,
  resolveRoles,
  roleCan,
  sanitizeAccess,
  sanitizeRoles,
  withRequirements,
  withoutPermission,
  type Permission,
} from '../src/shared/lib/permissions'
import type { Settings } from '../src/types/settings'
import type { Usuario } from '../src/types/usuario'

let n = 0
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)
/** Rejects with an HttpError of that status whose message matches. */
async function refused(fn: () => Promise<unknown>, status: number, pattern: RegExp, label: string) {
  await assert.rejects(fn, (err: unknown) => err instanceof HttpError && err.status === status && pattern.test(err.message), label)
}

// ─── The catalog ────────────────────────────────────────────────────────────────────────────────
assert.equal(new Set(ALL_PERMISSIONS).size, ALL_PERMISSIONS.length, 'no permission listed twice')
for (const g of PERMISSION_GROUPS) for (const p of g.permissions) for (const r of p.requires ?? []) assert.ok(ALL_PERMISSIONS.includes(r), `${p.key} requires an unknown ${r}`)
ok('cada permiso aparece una vez y solo depende de permisos que existen')

const closure = (p: Permission) => [...withRequirements([p])].sort()
assert.deepEqual(closure('proveedores.gestionar'), ['costos.ver', 'proveedores.gestionar'])
assert.deepEqual(closure('caja.gestionar'), ['caja.abrir', 'caja.cerrar', 'caja.gestionar', 'caja.verEsperado'])
assert.deepEqual(closure('stock.importar'), ['costos.ver', 'stock.importar', 'stock.ver'])
assert.deepEqual(closure('reportes.ver'), ['caja.verEsperado', 'reportes.ver', 'ventas.verTotales'])
assert.deepEqual(closure('ganancias.ver'), ['costos.ver', 'ganancias.ver'])
ok('activar un permiso activa lo que necesita (Proveedores y Ganancias → precios de compra, Reportes → efectivo esperado, Cajas → abrir/cerrar/ver esperado)')

const trimmed = withoutPermission(['costos.ver', 'ganancias.ver', 'proveedores.gestionar', 'stock.ver', 'stock.importar', 'ventas.fiar'], 'costos.ver')
assert.deepEqual([...trimmed].sort(), ['stock.ver', 'ventas.fiar'])
assert.deepEqual(needsOfRole(resolveRoles(undefined), ADMIN_ROLE_ID).slice(-1), ['admin'])
assert.deepEqual(needsOfRole(resolveRoles(undefined), 'no-existe'), [])
ok('quitar "Ver precios de compra" quita también Ganancias, Proveedores e Importar, y deja lo demás')

// ─── Default roles ──────────────────────────────────────────────────────────────────────────────
const defaults = resolveRoles(undefined)
assert.deepEqual(
  defaults.map((r) => r.id),
  [ADMIN_ROLE_ID, SUPERVISOR_ROLE_ID, CAJERO_ROLE_ID],
)
assert.deepEqual(defaults[0].permissions, ALL_PERMISSIONS)
for (const d of DEFAULT_ROLES) assert.deepEqual(sanitizeRoles([d]).find((r) => r.id === d.id)!.permissions, d.permissions, `${d.id} ya viene cerrado sobre sus requisitos`)
for (const p of ['costos.ver', 'ganancias.ver', 'ventas.verTotales', 'stock.ver', 'caja.verEsperado', 'caja.cerrar', 'fiados.abonar', 'facturas.corregir'] as Permission[]) {
  assert.equal(roleCan(defaults, CAJERO_ROLE_ID, p), false, `el Cajero no tiene ${p}`)
}
for (const p of ['clientes.editar', 'facturas.ver', 'caja.abrir', 'ventas.fiar'] as Permission[]) assert.equal(roleCan(defaults, CAJERO_ROLE_ID, p), true, `el Cajero sí tiene ${p}`)
assert.equal(roleCan(defaults, SUPERVISOR_ROLE_ID, 'costos.ver'), false)
assert.equal(roleCan(defaults, SUPERVISOR_ROLE_ID, 'ganancias.ver'), false)
assert.equal(roleCan(defaults, SUPERVISOR_ROLE_ID, 'caja.gestionar'), true)
assert.equal(roleCan(defaults, ADMIN_ROLE_ID, 'costos.ver'), true)
assert.equal(roleCan(defaults, 'rol-borrado', 'ventas.fiar'), false, 'un rol que no existe no permite nada')
ok('por defecto: el Cajero no ve costos, ganancias, totales ni el efectivo esperado; el Supervisor tampoco ve costos ni ganancias')

// ─── Cleaning a stored role list ────────────────────────────────────────────────────────────────
const messy = sanitizeRoles([
  { id: 'admin', name: 'Hacker', permissions: [] },
  { id: 'cajero', name: 'Renombrado', permissions: ['ventas.fiar', 'volar', 'proveedores.gestionar'] },
  { id: 'bodega', name: '  Bodega  ', permissions: ['stock.entradas'] },
  { id: 'bodega', name: 'Duplicado', permissions: [] },
  { id: 'sin-nombre', name: '   ', permissions: [] },
  'basura',
  null,
])
assert.deepEqual(
  messy.map((r) => r.id),
  [SUPERVISOR_ROLE_ID, CAJERO_ROLE_ID, 'bodega'],
)
const cajero = messy.find((r) => r.id === CAJERO_ROLE_ID)!
assert.equal(cajero.name, 'Cajero', 'los roles de fábrica conservan su nombre')
assert.deepEqual(cajero.permissions, ['ventas.fiar', 'costos.ver', 'proveedores.gestionar'], 'sin permisos inventados, con sus requisitos, en el orden del catálogo')
assert.deepEqual(messy.find((r) => r.id === 'bodega'), { id: 'bodega', name: 'Bodega', permissions: ['stock.ver', 'stock.entradas'] })
assert.deepEqual(messy.find((r) => r.id === SUPERVISOR_ROLE_ID)!.permissions, DEFAULT_ROLES[0].permissions, 'el Supervisor que faltaba vuelve con sus permisos de fábrica')
const many = sanitizeRoles(Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, name: `Rol ${i}`, permissions: [] })))
assert.equal(many.length, MAX_ROLES + 2, 'se recorta al máximo, sin perder los dos de fábrica')
ok('una lista de roles guardada se limpia: sin Administrador falso, sin permisos inventados ni ids repetidos, y con los roles de fábrica')

// ─── Access settings and new role ids ───────────────────────────────────────────────────────────
assert.deepEqual(sanitizeAccess(undefined, defaults), DEFAULT_ACCESS)
assert.deepEqual(sanitizeAccess({ mode: 'pin', counterRole: 'admin', autoLockMinutes: 7 }, defaults), { mode: 'pin', counterRole: CAJERO_ROLE_ID, autoLockMinutes: 5 })
assert.equal(sanitizeAccess({ counterRole: 'no-existe' }, defaults).counterRole, CAJERO_ROLE_ID)
assert.equal(sanitizeAccess({ counterRole: SUPERVISOR_ROLE_ID, autoLockMinutes: 0 }, defaults).autoLockMinutes, 0, '0 = nunca')
ok('el modo de acceso se limpia: el mostrador nunca es Administrador ni un rol inexistente')

assert.equal(newRoleId('Bodega', []), 'bodega')
assert.equal(newRoleId('Bodega', ['bodega']), 'bodega-2')
assert.equal(newRoleId('Cajero', []), 'cajero-2', 'nunca pisa un rol de fábrica')
assert.equal(newRoleId('Domiciliario Ñandú', []), 'domiciliario-nandu')
assert.equal(newRoleId('¡¡!!', []), 'rol')
ok('los roles nuevos reciben un id legible y que no choca')

// ─── Server rules (PGlite with the real migrations) ─────────────────────────────────────────────
const lite = await testDatabase()
const db = pgliteDb(lite)
const settings = async () => (await getRow<Settings>(db, 'settings', 'key', 'main'))!
const actor = (operatorId: string, roleId: string): Actor => ({
  sessionId: `s-${operatorId}`,
  operator: { id: operatorId, name: operatorId === OWNER_ID ? OWNER_NAME : operatorId, roleId },
  needs: new Set(needsOfRole(resolveRoles(undefined), roleId)),
})
const owner = actor(OWNER_ID, ADMIN_ROLE_ID)
const supervisor = actor('sup', SUPERVISOR_ROLE_ID)
/** Whose stored PIN this is (as the server finds it: by hash). */
const pinOwner = async (pin: string) =>
  (await lite.query<{ owner_id: string }>(`select owner_id from private.pins where hash = private.pin_digest($1)`, [sha256(pin)])).rows.map((r) => r.owner_id)

assert.deepEqual(await pinOwner('1234'), ['owner'], 'la migración deja el PIN de fábrica 1234 como PIN maestro, cifrado')
assert.equal('pinHash' in (await settings()), false, 'y no en los ajustes que leen los dispositivos')

await refused(() => db.tx((q) => createUsuario(q, supervisor, { name: 'Ana', role: CAJERO_ROLE_ID, pin: '4821', active: true })), 403, /administrador/, 'un Supervisor no crea usuarios')
const ana = await db.tx((q) => createUsuario(q, owner, { name: '  Ana  ', role: CAJERO_ROLE_ID, pin: '4821', active: true }))
assert.equal(ana.name, 'Ana')
assert.equal(ana.pinLength, 4)
assert.ok(ana.id && ana.createdAt)
assert.equal('pinHash' in ana || 'pin' in ana, false, 'la fila del usuario no lleva su PIN')
assert.deepEqual(await pinOwner('4821'), [`user:${ana.id}`])
ok('solo el Administrador crea usuarios; el PIN queda cifrado aparte, nunca en la fila del usuario')

await db.tx((q) => changeOwnerPin(q, owner, '2580', 4))
assert.deepEqual(await pinOwner('2580'), ['owner'])
assert.deepEqual(await pinOwner('1234'), [], 'el PIN de fábrica deja de servir')
await refused(() => db.tx((q) => changeOwnerPin(q, supervisor, '3691', 4)), 403, /administrador/, 'un Supervisor no cambia el PIN maestro')
await refused(() => db.tx((q) => changeOwnerPin(q, owner, '4821', 4)), 409, /ya lo usa/, 'PIN maestro igual al de un usuario')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '4821', active: true })), 409, /ya lo usa/, 'PIN de otro usuario')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '2580', active: true })), 409, /ya lo usa/, 'PIN maestro')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '1111', active: true })), 400, /fácil/, 'PIN obvio')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '731', active: true })), 400, /4 dígitos/, 'PIN corto')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: 'ANA', role: CAJERO_ROLE_ID, pin: '7310', active: true })), 409, /Ya hay un usuario/, 'nombre repetido')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: 'Luis', role: 'bodega', pin: '7310', active: true })), 400, /rol no existe/, 'rol inexistente')
await refused(() => db.tx((q) => createUsuario(q, owner, { name: '   ', role: CAJERO_ROLE_ID, pin: '7310', active: true })), 400, /nombre/, 'sin nombre')
assert.equal((await listAll<Usuario>(db, 'usuarios')).length, 1, 'ninguno de los intentos fallidos guardó algo')
ok('el servidor rechaza un PIN repetido (con otro usuario o con el PIN maestro), obvio o corto, un nombre repetido y un rol inexistente')

const edited = await db.tx((q) => updateUsuario(q, owner, ana.id, { name: 'Ana María', role: SUPERVISOR_ROLE_ID, active: true }))
assert.deepEqual(await pinOwner('4821'), [`user:${ana.id}`], 'sin PIN nuevo conserva el que tenía')
assert.equal(edited.role, SUPERVISOR_ROLE_ID)
const luis = await db.tx((q) => createUsuario(q, owner, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '7310', active: true }))
await refused(() => db.tx((q) => updateUsuario(q, owner, luis.id, { name: 'ana maría', role: CAJERO_ROLE_ID, active: true })), 409, /Ya hay un usuario/, 'renombrar a un nombre tomado')
await refused(() => db.tx((q) => updateUsuario(q, owner, luis.id, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '4821', active: true })), 409, /ya lo usa/, 'cambiar a un PIN tomado')
const samePin = await db.tx((q) => updateUsuario(q, owner, luis.id, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '7310', active: false }))
assert.equal(samePin.active, false, 'volver a guardar su propio PIN no choca consigo mismo')
await db.tx((q) => updateUsuario(q, owner, luis.id, { name: 'Luis', role: CAJERO_ROLE_ID, pin: '9047', active: true }))
assert.deepEqual(await pinOwner('7310'), [], 'el PIN viejo deja de servir')
assert.deepEqual(await pinOwner('9047'), [`user:${luis.id}`])
ok('al editar: conserva el PIN si no se cambia, el nuevo reemplaza al viejo, y no deja tomar el nombre o el PIN de otro')

// Roles saved through the settings
await refused(() => db.tx((q) => applySettingsPatch(q, supervisor, { roles: DEFAULT_ROLES })), 403, /administrador/, 'un Supervisor no edita roles')
await db.tx((q) => applySettingsPatch(q, supervisor, { theme: 'dark' }))
assert.equal((await settings()).theme, 'dark', 'el tema sí lo cambia cualquiera')
await db.tx((q) => applySettingsPatch(q, owner, { roles: [...DEFAULT_ROLES, { id: 'bodega', name: 'Bodega', permissions: ['stock.entradas', 'inventado' as Permission] }] }))
const storedBodega = (await settings()).roles!.find((r) => r.id === 'bodega')!
assert.deepEqual(storedBodega.permissions, ['stock.ver', 'stock.entradas'], 'el servidor limpia los permisos que guarda')
const pedro = await db.tx((q) => createUsuario(q, owner, { name: 'Pedro', role: 'bodega', pin: '5096', active: true }))
assert.equal(pedro.role, 'bodega', 'un rol propio sirve en cuanto existe')
await refused(() => db.tx((q) => applySettingsPatch(q, owner, { roles: DEFAULT_ROLES })), 409, /Pedro/, 'quitar un rol que alguien tiene')
assert.ok((await settings()).roles!.some((r) => r.id === 'bodega'), 'el rol sigue ahí')
await db.tx((q) => applySettingsPatch(q, owner, { access: { mode: 'abierto', counterRole: 'bodega', autoLockMinutes: 10 } }))
assert.equal((await settings()).access!.counterRole, 'bodega')
await db.tx((q) => updateUsuario(q, owner, pedro.id, { name: 'Pedro', role: CAJERO_ROLE_ID, active: true }))
await db.tx((q) => applySettingsPatch(q, owner, { roles: DEFAULT_ROLES }))
assert.ok(!(await settings()).roles!.some((r) => r.id === 'bodega'), 'ya nadie lo tenía: se pudo quitar')
assert.equal((await settings()).access!.counterRole, CAJERO_ROLE_ID, 'el mostrador que usaba ese rol vuelve a Cajero')
ok('los roles se guardan limpios y solo los edita el Administrador; un rol con usuarios no se puede quitar, y el mostrador nunca queda con un rol borrado')

await db.tx((q) => applySettingsPatch(q, owner, { access: { mode: 'pin', counterRole: ADMIN_ROLE_ID, autoLockMinutes: 15 } }))
assert.deepEqual((await settings()).access, { mode: 'pin', counterRole: CAJERO_ROLE_ID, autoLockMinutes: 15 })
for (const key of ['pinHash', 'pinLength', 'cajaBase', 'lastCajero', 'pinLockedUntil']) {
  await refused(() => db.tx((q) => applySettingsPatch(q, owner, { [key]: 1 })), 400, /no se cambia aquí/, `${key} no se cambia por los ajustes`)
}
await db.tx((q) => applySettingsPatch(q, owner, { storeName: '  Plastimax  ', business: { nit: '900.1', extra: 'x' } }))
const after = await settings()
assert.equal(after.storeName, 'Plastimax')
assert.deepEqual(after.business, { nit: '900.1', phone: '', address: '', receiptFooter: '' })
ok('el modo de acceso se guarda limpio; el PIN, la base de la caja y el último cajero no se tocan por los ajustes')

await db.tx((q) => deleteUsuario(q, owner, luis.id))
assert.deepEqual(await pinOwner('9047'), [], 'borrar un usuario borra su PIN')
ok('borrar un usuario se lleva su PIN')

await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones de roles y usuarios pasaron.`)
