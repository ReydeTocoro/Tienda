/** Self-check for roles, permissions and users: the permission catalog and its requirements, how a
 * stored role list is cleaned, and the server rules on users and settings (Administrador only, each
 * user with their own account — an email nobody else has, a password only Supabase keeps —, unique
 * name and PIN, an existing role, no deleting a role someone has, no locking yourself out, PINs
 * hashed where no browser reads them) on an in-memory Postgres (PGlite) built from the real
 * migrations, with Supabase Auth's accounts faked — never the Supabase data:  npm run check:roles */
import assert from 'node:assert/strict'
import { pgliteDb } from './db'
import { fakeAccounts, testDatabase } from './testDb'
import { changeOwnerPin, sha256, type Actor } from './domain/counter'
import { applySettingsPatch, createUsuario, deleteUsuario, updateUsuario } from './domain/users'
import { getRow, listAll } from './routes/generic'
import { MAX_PASSWORD, MIN_PASSWORD, cleanEmail, newPasswordProblem } from '../src/shared/lib/account'
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


// ─── Session settings and new role ids ──────────────────────────────────────────────────────────
assert.deepEqual(sanitizeAccess(undefined), DEFAULT_ACCESS)
assert.deepEqual(sanitizeAccess({ mode: 'pin', counterRole: 'admin', autoLockMinutes: 5 }), { idleSignOutMinutes: 0 }, 'lo del mostrador abierto y el bloqueo con PIN se descartan')
assert.equal(sanitizeAccess({ idleSignOutMinutes: 15 }).idleSignOutMinutes, 15)
assert.equal(sanitizeAccess({ idleSignOutMinutes: 7 }).idleSignOutMinutes, 0, 'un valor que no está en la lista vuelve a "nunca"')
ok('los ajustes de sesión se limpian: solo el cierre por inactividad, con un valor de la lista')

assert.equal(cleanEmail('  Ana@Tienda.CO '), 'ana@tienda.co', 'el correo se guarda sin espacios y en minúsculas')
for (const bad of ['ana', 'ana@tienda', 'ana tienda@x.co', '@x.co', 'a@@x.co', '', undefined, 42, `${'a'.repeat(250)}@x.co`]) assert.equal(cleanEmail(bad), '', `no es un correo: ${String(bad).slice(0, 20)}`)
assert.match(newPasswordProblem('a'.repeat(MIN_PASSWORD - 1), 'a'.repeat(MIN_PASSWORD - 1))!, /al menos 8/)
assert.match(newPasswordProblem('a'.repeat(MAX_PASSWORD + 1), 'a'.repeat(MAX_PASSWORD + 1))!, /hasta 72/)
assert.match(newPasswordProblem('abcdefgh', 'abcdefgx')!, /no coinciden/)
assert.equal(newPasswordProblem('abcdefgh', 'abcdefgh'), null)
ok('el correo se limpia y la contraseña pide de 8 a 72 caracteres, escrita igual dos veces')

assert.equal(newRoleId('Bodega', []), 'bodega')
assert.equal(newRoleId('Bodega', ['bodega']), 'bodega-2')
assert.equal(newRoleId('Cajero', []), 'cajero-2', 'nunca pisa un rol de fábrica')
assert.equal(newRoleId('Domiciliario Ñandú', []), 'domiciliario-nandu')
assert.equal(newRoleId('¡¡!!', []), 'rol')
ok('los roles nuevos reciben un id legible y que no choca')

// ─── Server rules (PGlite with the real migrations) ─────────────────────────────────────────────
const lite = await testDatabase()
const db = pgliteDb(lite)
const accounts = fakeAccounts()
const settings = async () => (await getRow<Settings>(db, 'settings', 'key', 'main'))!
const users = async () => listAll<Usuario>(db, 'usuarios')
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

const ANA = { name: 'Ana', role: CAJERO_ROLE_ID, email: 'ana@tienda.co', password: 'cajera-2026', active: true }
await refused(() => db.tx((q) => createUsuario(q, supervisor, ANA, accounts)), 403, /administrador/, 'un Supervisor no crea usuarios')
const ana = await db.tx((q) => createUsuario(q, owner, { ...ANA, name: '  Ana  ', email: '  Ana@Tienda.CO ', pin: '4821' }, accounts))
assert.equal(ana.name, 'Ana')
assert.equal(ana.email, 'ana@tienda.co', 'el correo se guarda limpio, en minúsculas')
assert.equal(ana.pinLength, 4)
assert.ok(ana.id && ana.createdAt)
assert.equal(accounts.passwords.get('ana@tienda.co'), 'cajera-2026', 'su cuenta queda creada con esa contraseña')
assert.equal('pinHash' in ana || 'pin' in ana || 'password' in ana, false, 'la fila del usuario no lleva ni su PIN ni su contraseña')
assert.equal(JSON.stringify((await lite.query(`select data from usuarios`)).rows).includes('cajera-2026'), false, 'la contraseña no queda en la base de datos')
assert.deepEqual(await pinOwner('4821'), [`user:${ana.id}`])
ok('solo el Administrador crea usuarios, cada uno con su correo y su cuenta; el PIN queda cifrado aparte y la contraseña solo en Supabase')

await lite.query(`insert into public.staff (email, name) values ('dueno@tienda.co', 'Propietario')`)
await db.tx((q) => changeOwnerPin(q, owner, '2580', 4))
assert.deepEqual(await pinOwner('2580'), ['owner'])
assert.deepEqual(await pinOwner('1234'), [], 'el PIN de fábrica deja de servir')
await refused(() => db.tx((q) => changeOwnerPin(q, supervisor, '3691', 4)), 403, /administrador/, 'un Supervisor no cambia el PIN maestro')
await refused(() => db.tx((q) => changeOwnerPin(q, owner, '4821', 4)), 409, /ya lo usa/, 'PIN maestro igual al de un usuario')
const LUIS = { name: 'Luis', role: CAJERO_ROLE_ID, email: 'luis@tienda.co', password: 'luis-2026-ok', active: true }
const tryCreate = (input: Record<string, unknown>) => db.tx((q) => createUsuario(q, owner, { ...LUIS, ...input }, accounts))
await refused(() => tryCreate({ email: 'ANA@tienda.co' }), 409, /ya lo usa Ana/, 'correo de otro usuario')
await refused(() => tryCreate({ email: 'Dueno@Tienda.co' }), 409, /propietario/, 'correo del propietario')
await refused(() => tryCreate({ email: 'luis' }), 400, /correo válido/, 'correo inválido')
await refused(() => tryCreate({ email: undefined }), 400, /correo válido/, 'sin correo')
await refused(() => tryCreate({ password: undefined }), 400, /contraseña/, 'sin contraseña')
await refused(() => tryCreate({ password: 'corta' }), 400, /al menos 8/, 'contraseña corta')
await refused(() => tryCreate({ pin: '4821' }), 409, /ya lo usa/, 'PIN de otro usuario')
await refused(() => tryCreate({ pin: '2580' }), 409, /ya lo usa/, 'PIN maestro')
await refused(() => tryCreate({ pin: '1111' }), 400, /fácil/, 'PIN obvio')
await refused(() => tryCreate({ pin: '731' }), 400, /4 dígitos/, 'PIN corto')
await refused(() => tryCreate({ name: 'ANA' }), 409, /Ya hay un usuario/, 'nombre repetido')
await refused(() => tryCreate({ role: 'bodega' }), 400, /rol no existe/, 'rol inexistente')
await refused(() => tryCreate({ name: '   ' }), 400, /nombre/, 'sin nombre')
accounts.refuse = (p) => p === 'rechazada-123'
await refused(() => tryCreate({ password: 'rechazada-123' }), 400, /débil/, 'Supabase rechaza la contraseña')
assert.equal((await users()).length, 1, 'ninguno de los intentos fallidos guardó algo')
assert.deepEqual([...accounts.passwords.keys()], ['ana@tienda.co'], 'ni creó cuentas')
ok('el servidor rechaza un correo ajeno (de otro usuario o del propietario) o inválido, una contraseña ausente, corta o que Supabase no acepta, un PIN repetido, obvio o corto, un nombre repetido y un rol inexistente')

const luis = await tryCreate({})
assert.equal(luis.pinLength, undefined, 'el PIN es opcional')
assert.equal((await lite.query(`select 1 from private.pins where owner_id = $1`, [`user:${luis.id}`])).rows.length, 0)
ok('el PIN para autorizar es opcional')

const edited = await db.tx((q) => updateUsuario(q, owner, ana.id, { name: 'Ana María', role: SUPERVISOR_ROLE_ID, active: true }, accounts))
assert.equal(edited.role, SUPERVISOR_ROLE_ID)
assert.equal(edited.email, 'ana@tienda.co', 'sin correo en el cambio conserva el suyo')
assert.equal(accounts.passwords.get('ana@tienda.co'), 'cajera-2026', 'y su contraseña')
assert.deepEqual(await pinOwner('4821'), [`user:${ana.id}`], 'y su PIN')
const tryUpdate = (input: Record<string, unknown>) => db.tx((q) => updateUsuario(q, owner, luis.id, { ...LUIS, password: undefined, ...input }, accounts))
await refused(() => tryUpdate({ name: 'ana maría' }), 409, /Ya hay un usuario/, 'renombrar a un nombre tomado')
await refused(() => tryUpdate({ pin: '4821' }), 409, /ya lo usa/, 'cambiar a un PIN tomado')
await refused(() => tryUpdate({ email: 'ana@tienda.co' }), 409, /ya lo usa Ana/, 'tomar el correo de otro')
await refused(() => tryUpdate({ email: '' }), 400, /correo válido/, 'quitarle el correo')
await tryUpdate({ email: 'luis.p@tienda.co' })
assert.equal(accounts.passwords.has('luis@tienda.co'), false)
assert.equal(accounts.passwords.get('luis.p@tienda.co'), 'luis-2026-ok', 'el correo nuevo se lleva la cuenta, con su contraseña')
await refused(() => tryUpdate({ email: 'luis@tienda.co', password: 'rechazada-123' }), 400, /débil/, 'correo nuevo con una contraseña que Supabase rechaza')
assert.equal(accounts.passwords.get('luis.p@tienda.co'), 'luis-2026-ok', 'la cuenta vuelve a su correo')
assert.equal((await getRow<Usuario>(db, 'usuarios', 'id', luis.id))!.email, 'luis.p@tienda.co', 'y el usuario lo conserva')
await tryUpdate({ email: 'luis.p@tienda.co', password: 'nueva-clave-9' })
assert.equal(accounts.passwords.get('luis.p@tienda.co'), 'nueva-clave-9', 'cambiar la contraseña')
await tryUpdate({ email: 'luis.p@tienda.co', pin: '7310' })
const samePin = await tryUpdate({ email: 'luis.p@tienda.co', pin: '7310', active: false })
assert.equal(samePin.active, false, 'volver a guardar su propio PIN no choca consigo mismo')
await tryUpdate({ email: 'luis.p@tienda.co', pin: '9047' })
assert.deepEqual(await pinOwner('7310'), [], 'el PIN viejo deja de servir')
assert.deepEqual(await pinOwner('9047'), [`user:${luis.id}`])
ok('al editar: conserva correo, contraseña y PIN si no se cambian; el correo nuevo se lleva la cuenta (que vuelve si Supabase rechaza la contraseña); no deja tomar el nombre, el correo ni el PIN de otro')

await lite.query(`insert into public.usuarios (id, data) values ('viejo', '{"id":"viejo","name":"Viejo","role":"cajero","active":true,"createdAt":"2026-01-01T00:00:00Z"}')`)
await db.tx((q) => updateUsuario(q, owner, 'viejo', { name: 'Viejo', role: CAJERO_ROLE_ID, active: false }, accounts))
await refused(() => db.tx((q) => updateUsuario(q, owner, 'viejo', { name: 'Viejo', role: CAJERO_ROLE_ID, email: 'viejo@tienda.co', active: true }, accounts)), 400, /contraseña/, 'correo sin contraseña')
await db.tx((q) => updateUsuario(q, owner, 'viejo', { name: 'Viejo', role: CAJERO_ROLE_ID, email: 'viejo@tienda.co', password: 'viejo-2026-x', active: true }, accounts))
assert.equal(accounts.passwords.get('viejo@tienda.co'), 'viejo-2026-x')
ok('un usuario de antes, sin cuenta: se activa o desactiva igual, y recibe su cuenta con correo y contraseña')

const noKey = fakeAccounts(false)
const sinLlave = await db.tx((q) => createUsuario(q, owner, { name: 'Sin llave', role: CAJERO_ROLE_ID, email: 'sinllave@tienda.co', active: true }, noKey))
assert.equal(sinLlave.email, 'sinllave@tienda.co')
await refused(
  () => db.tx((q) => createUsuario(q, owner, { name: 'Otra', role: CAJERO_ROLE_ID, email: 'otra@tienda.co', password: 'una-clave-123', active: true }, noKey)),
  503,
  /Supabase/,
  'sin la llave no pone contraseñas',
)
await db.tx((q) => deleteUsuario(q, owner, sinLlave.id, noKey))
ok('sin la llave secreta de Supabase: guarda el correo (la cuenta se crea en el panel de Supabase) y no acepta contraseñas')

const gerenteRow = await db.tx((q) => createUsuario(q, owner, { name: 'Gerente', role: ADMIN_ROLE_ID, email: 'gerente@tienda.co', password: 'gerente-2026', active: true }, accounts))
const gerente = actor(gerenteRow.id, ADMIN_ROLE_ID)
const selfEdit = (input: Record<string, unknown>) => db.tx((q) => updateUsuario(q, gerente, gerenteRow.id, { name: 'Gerente', role: ADMIN_ROLE_ID, active: true, ...input }, accounts))
await refused(() => selfEdit({ active: false }), 409, /desactivar tu propio/, 'desactivarse')
await refused(() => selfEdit({ role: SUPERVISOR_ROLE_ID }), 409, /Administrador/, 'quitarse el rol')
await refused(() => db.tx((q) => deleteUsuario(q, gerente, gerenteRow.id, accounts)), 409, /eliminar tu propio/, 'eliminarse')
await selfEdit({ password: 'gerente-nueva-1' })
assert.equal(accounts.passwords.get('gerente@tienda.co'), 'gerente-nueva-1', 'sí puede cambiar su propia contraseña')
ok('un administrador no puede dejarse por fuera: ni desactivarse, ni quitarse el rol, ni eliminarse')

// Roles saved through the settings
await refused(() => db.tx((q) => applySettingsPatch(q, supervisor, { roles: DEFAULT_ROLES })), 403, /administrador/, 'un Supervisor no edita roles')
await db.tx((q) => applySettingsPatch(q, supervisor, { theme: 'dark' }))
assert.equal((await settings()).theme, 'dark', 'el tema sí lo cambia cualquiera')
await db.tx((q) => applySettingsPatch(q, owner, { roles: [...DEFAULT_ROLES, { id: 'bodega', name: 'Bodega', permissions: ['stock.entradas', 'inventado' as Permission] }] }))
const storedBodega = (await settings()).roles!.find((r) => r.id === 'bodega')!
assert.deepEqual(storedBodega.permissions, ['stock.ver', 'stock.entradas'], 'el servidor limpia los permisos que guarda')
const pedro = await db.tx((q) => createUsuario(q, owner, { name: 'Pedro', role: 'bodega', email: 'pedro@tienda.co', password: 'pedro-2026-x', active: true }, accounts))
assert.equal(pedro.role, 'bodega', 'un rol propio sirve en cuanto existe')
await refused(() => db.tx((q) => applySettingsPatch(q, owner, { roles: DEFAULT_ROLES })), 409, /Pedro/, 'quitar un rol que alguien tiene')
assert.ok((await settings()).roles!.some((r) => r.id === 'bodega'), 'el rol sigue ahí')
await db.tx((q) => updateUsuario(q, owner, pedro.id, { name: 'Pedro', role: CAJERO_ROLE_ID, active: true }, accounts))
await db.tx((q) => applySettingsPatch(q, owner, { roles: DEFAULT_ROLES }))
assert.ok(!(await settings()).roles!.some((r) => r.id === 'bodega'), 'ya nadie lo tenía: se pudo quitar')
ok('los roles se guardan limpios y solo los edita el Administrador; un rol con usuarios no se puede quitar')

await db.tx((q) => applySettingsPatch(q, owner, { access: { idleSignOutMinutes: 15, mode: 'pin', counterRole: 'admin' } }))
assert.deepEqual((await settings()).access, { idleSignOutMinutes: 15 })
for (const key of ['pinHash', 'pinLength', 'cajaBase', 'lastCajero', 'pinLockedUntil']) {
  await refused(() => db.tx((q) => applySettingsPatch(q, owner, { [key]: 1 })), 400, /no se cambia aquí/, `${key} no se cambia por los ajustes`)
}
await db.tx((q) => applySettingsPatch(q, owner, { storeName: '  Plastimax  ', business: { nit: '900.1', extra: 'x' } }))
const after = await settings()
assert.equal(after.storeName, 'Plastimax')
assert.deepEqual(after.business, { nit: '900.1', phone: '', address: '', receiptFooter: '' })
ok('el cierre por inactividad se guarda limpio; el PIN, la base de la caja y el último cajero no se tocan por los ajustes')

await db.tx((q) => deleteUsuario(q, owner, luis.id, accounts))
assert.deepEqual(await pinOwner('9047'), [], 'borrar un usuario borra su PIN')
assert.equal(accounts.passwords.has('luis.p@tienda.co'), false, 'y su cuenta')
ok('borrar un usuario se lleva su PIN y su cuenta')

await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones de roles y usuarios pasaron.`)
