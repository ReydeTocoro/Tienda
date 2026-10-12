/** Self-check of sharing a receipt by e-mail and WhatsApp, on an in-memory Postgres (PGlite) built from
 * the real migrations — never the Supabase data, and no e-mail is ever sent (a fake mailer keeps what
 * it was asked to send):  npm run check:receipts
 *
 * - The receipt is built from the saved sale and carries no cost, profit or note.
 * - The WhatsApp link: a random 128-bit code, one per sale (sharing again refreshes it), 30 days,
 *   a bad code is a 404 and an expired one a 410, expired links are cleaned up, and no browser can
 *   read the table.
 * - The e-mail: HTML-escaped, the PDF attached only when it really is one, a store without mail set
 *   up answers 503, a bad address 400, and an account can't send more than 40 an hour.
 * - Over the real API (Express): the page behind the link needs no sign-in, every other route does. */
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { RequestHandler } from 'express'
import { createApp } from './app'
import type { AuthInfo } from './auth'
import { pgliteDb } from './db'
import { checkAccount, refreshCounterPerms } from './domain/counter'
import { receiptEmail } from './domain/receiptEmail'
import { RECEIPT_LINK_DAYS, receiptOfSale, shareReceipt, sharedReceipt } from './domain/receipts'
import { noMailer, type MailMessage, type Mailer } from './mailer'
import { pdfAttachment } from './routes/receipts'
import { HttpError } from './routes/http'
import { asBrowser, testDatabase } from './testDb'
import { RECEIPT_COLS, receiptText, type ReceiptData } from '../src/shared/lib/receipt'

let n = 0
console.info = () => {} // the routes log who shared what; not needed here
const ok = (label: string) => console.log(`  ok ${++n} — ${label}`)

const lite = await testDatabase()
const db = pgliteDb(lite)
await lite.exec(`
insert into public.staff (email, name) values ('dueno@x.com', 'Propietario');
update public.settings set data = data || '{"storeName":"Plastimax F.R.","business":{"nit":"900.123.456","phone":"300 123 4567","address":"Cra 1 # 2-3","receiptFooter":"¡Vuelve pronto!"}}';
`)

const NASTY = '<img src=x onerror=alert(1)> & "Co" \'x\''
const SALE = {
  items: [
    { code: 'A1', name: 'Balde', price: 2000, cost: 1200, qty: 2, brand: '', unit: 'unidad', isFree: false },
    { code: 'Q1', name: 'Cuerda', price: 4000, cost: 2500, qty: 1.5, brand: '', unit: 'm', isFree: false },
    { code: 'N1', name: NASTY, price: 1000, qty: 1, brand: '', unit: 'unidad', isFree: false },
  ],
  subtotal: 8000,
  discount: 500,
  total: 7500,
  ganancia: 3000,
  payMethod: 'efectivo',
  customerName: 'Ana Gómez',
  date: '2026-10-12T15:30:00.000Z',
  dayKey: '2026-10-12',
  notes: 'nota interna: no decirle al cliente',
  sellerName: 'Pepe',
  amountReceived: 10000,
  changeGiven: 2500,
}
const insertSale = async (sale: object) => Number((await lite.query<{ id: string }>(`insert into public.sales (data) values ($1) returning id`, [JSON.stringify(sale)])).rows[0].id)
const saleId = await insertSale(SALE)

// ─── 1. The receipt, built from the saved sale ───────────────────────────────────────────────────
const receipt = await receiptOfSale(db, saleId)
assert.equal(receipt.number, '#' + String(saleId).padStart(4, '0'))
assert.equal(receipt.storeName, 'Plastimax F.R.')
assert.equal(receipt.business?.nit, '900.123.456')
assert.equal(receipt.items.length, 3)
assert.equal(receipt.total, 7500)
assert.equal(receipt.amountReceived, 10000)
assert.equal(receipt.customerName, 'Ana Gómez')
const dump = JSON.stringify(receipt)
for (const secret of ['cost', 'ganancia', 'nota interna', '1200', '2500,']) assert.equal(dump.includes(secret), false, `el recibo no debe llevar "${secret}"`)
await assert.rejects(() => receiptOfSale(db, 999999), (e) => e instanceof HttpError && e.status === 404)
assert.match(receiptText(receipt), /RECIBO DE VENTA #\d{4}/)
assert.match(receiptText(receipt), /1,5m +Cuerda/, 'lo que se vende por medida lleva su unidad en la columna de cantidades')
ok('el recibo sale de la venta guardada y no lleva costos, ganancia ni notas')

// ─── 1b. What the customer reads: the discount of each product and the account a transfer came into ─────────────
const saleT = await insertSale({
  items: [{ code: 'A1', name: 'Balde', price: 2000, cost: 1200, qty: 2, discount: 500, brand: '', unit: 'unidad', isFree: false }],
  subtotal: 4000,
  discount: 500,
  total: 3500,
  ganancia: 1100,
  payMethod: 'transferencia',
  transferAccount: 'nequi',
  date: '2026-10-12T15:30:00.000Z',
  dayKey: '2026-10-12',
})
const receiptT = await receiptOfSale(db, saleT)
assert.equal(receiptT.items[0].discount, 500)
assert.equal(receiptT.transferAccount, 'nequi')
assert.match(receiptText(receiptT), / 2 +Balde +\$2\.000,00 +\$4\.000,00\n +Desc\. +-\$500,00/, 'el texto (y el PDF, que lo dibuja) dice a qué producto se le descontó')
assert.match(receiptText(receiptT), /Pago +Transferencia · Nequi/, 'y la cuenta de la transferencia')
const mailT = receiptEmail(receiptT)
assert.match(mailT.html, /Descuento −\$500,00/)
assert.match(mailT.html, /Transferencia · Nequi/)
assert.match(mailT.text, /descuento -\$500,00/)
assert.equal(JSON.stringify(receiptT).includes('ganancia'), false, 'y sigue sin llevar la ganancia')
ok('el recibo del cliente (texto, PDF, correo, página de WhatsApp) dice el descuento de cada producto y la cuenta de una transferencia')

// ─── 1c. The products in columns: quantities in a straight column, the values flush right, long names wrapped ───────
const wide: ReceiptData = {
  ...receiptT,
  items: [
    { name: 'LAPIZ ROJO PARA CONSTRUCCION', qty: 3, unit: 'unidad', price: 2000 },
    { name: 'BOLSA EXTRA JUMBO PAQUETE X 10 NUNIDADES', qty: 12, unit: 'unidad', price: 9800 },
    { name: 'CUERDA', qty: 1.5, unit: 'm', price: 4000 },
    { name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ', qty: 1, unit: 'unidad', price: 1000 },
  ],
  discount: 0,
}
const textW = receiptText(wide).split('\n')
assert.ok(textW.every((l) => l.length <= RECEIPT_COLS), 'ninguna línea pasa del ancho del rollo')
const header = textW.findIndex((l) => /^CANT +DESCRIPCIÓN +P\.UNIT +VALOR$/.test(l))
assert.ok(header > 0, 'hay encabezado de columnas')
const rows = textW.slice(header + 1, textW.findIndex((l, k) => k > header && /^-+$/.test(l)))
const first = rows.filter((l) => /\$/.test(l))
assert.equal(first.length, 4, 'cada producto tiene su valor en su primera línea')
assert.ok(first.some((l) => /^ +3 +LAPIZ.* \$2\.000,00 +\$6\.000,00$/.test(l)), 'con el precio de una unidad ($2.000) y el valor de la línea ($6.000)')
const qtyEnd = (l: string) => l.match(/^ *\S+/)![0].length // where the quantity of a row ends
assert.ok(first.every((l) => qtyEnd(l) === qtyEnd(first[0])), 'las cantidades terminan todas en la misma columna (a la derecha)')
assert.ok(first.every((l) => l.length === first[0].length), 'y los valores terminan todos en la misma columna (a la derecha)')
const continued = rows.filter((l) => !/\$/.test(l))
assert.ok(continued.length >= 2 && continued.every((l) => /^ {5}\S/.test(l)), 'los nombres largos siguen en la línea de abajo, dentro de su columna (debajo del nombre, no de la cantidad)')
ok('el recibo en texto/PDF pone las cantidades en una columna recta, los valores alineados a la derecha y baja a otra línea los nombres largos, sin pasar del ancho del rollo')

// ─── 2. The WhatsApp link ────────────────────────────────────────────────────────────────────────
const link = await shareReceipt(db, saleId)
assert.match(link.id, /^[0-9a-f]{32}$/, '128 bits en hexadecimal')
const days = (new Date(link.expiresAt).getTime() - Date.now()) / 86_400_000
assert.ok(Math.abs(days - RECEIPT_LINK_DAYS) < 0.01 && RECEIPT_LINK_DAYS === 30, 'dura 30 días')
const opened = await sharedReceipt(db, link.id)
assert.deepEqual(opened.receipt, JSON.parse(JSON.stringify(receipt)), 'el enlace muestra el recibo tal cual')

await lite.query(`update public.sales set data = data || '{"total":7000,"discount":1000}' where id = $1`, [saleId])
const again = await shareReceipt(db, saleId)
assert.equal(again.id, link.id, 'compartir la misma venta otra vez conserva el enlace')
assert.equal((await sharedReceipt(db, link.id)).receipt.total, 7000, 'y lo pone al día (una venta corregida muestra la corrección)')
assert.equal(Number((await lite.query<{ c: string }>(`select count(*) as c from private.shared_receipts`)).rows[0].c), 1)

for (const bad of ['', 'abc', 'A'.repeat(32), link.id.toUpperCase(), link.id + '0', '../etc/passwd', "' or 1=1 --"]) {
  await assert.rejects(() => sharedReceipt(db, bad), (e) => e instanceof HttpError && e.status === 404, `código inválido: ${bad}`)
}
await assert.rejects(() => sharedReceipt(db, '0'.repeat(32)), (e) => e instanceof HttpError && e.status === 404, 'un código que no existe')
ok('un código aleatorio de 128 bits, un enlace por venta que se actualiza, y los códigos inválidos o inexistentes dan 404')

await lite.query(`update private.shared_receipts set expires_at = now() - interval '1 day'`)
await assert.rejects(() => sharedReceipt(db, link.id), (e) => e instanceof HttpError && e.status === 410, 'vencido: 410')
const other = await insertSale({ ...SALE, total: 100 })
const second = await shareReceipt(db, other)
assert.notEqual(second.id, link.id)
assert.equal(Number((await lite.query<{ c: string }>(`select count(*) as c from private.shared_receipts where id = $1`, [link.id])).rows[0].c), 0, 'al crear otro enlace se borran los vencidos')
const third = await shareReceipt(db, saleId)
assert.notEqual(third.id, link.id, 'y un enlace ya borrado no reaparece: la venta recibe uno nuevo')
ok('un enlace vencido da 410 y se borra al crear otros')

await assert.rejects(
  () => asBrowser(lite, { email: 'dueno@x.com', session_id: 's', role: 'authenticated' }, async () => lite.query(`select * from private.shared_receipts`)),
  /permission denied/i,
  'ni la sesión del dueño lee la tabla desde el navegador',
)
await assert.rejects(() => asBrowser(lite, null, async () => lite.query(`select * from private.shared_receipts`)), /permission denied/i, 'ni sin sesión')
ok('ningún navegador puede leer ni listar los recibos compartidos: solo se entra por la API')

// ─── 3. The e-mail ───────────────────────────────────────────────────────────────────────────────
const mail = receiptEmail(receipt)
assert.equal(mail.html.includes('<img src=x'), false, 'el HTML no deja pasar etiquetas del nombre de un producto')
assert.ok(mail.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot; &#39;x&#39;'), 'se escapan <, >, &, " y \'')
assert.ok(mail.html.includes('$7.500,00') && mail.html.includes('Plastimax F.R.') && mail.html.includes('¡Vuelve pronto!'))
assert.ok(mail.html.includes('Efectivo recibido') && mail.html.includes('Cambio'))
assert.ok(mail.text.includes('TOTAL: $7.500,00') && mail.text.includes('1,5m Cuerda'))
assert.equal(mail.subject, `Recibo de venta ${receipt.number} — Plastimax F.R.`)
assert.equal(mail.html.includes('nota interna'), false)
ok('el cuerpo del correo escapa todo lo que viene de la venta y no lleva notas')

const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.3\n'), Buffer.alloc(300, 'x')])
assert.ok(pdfAttachment(pdfBytes.toString('base64'))?.subarray(0, 5).toString() === '%PDF-', 'un PDF de verdad pasa')
for (const notPdf of [undefined, 42, '', 'AAAA', Buffer.alloc(500, 'x').toString('base64'), pdfBytes.toString('base64') + 'A'.repeat(1.5 * 1024 * 1024)]) {
  assert.equal(pdfAttachment(notPdf), null, 'lo que no es un PDF pequeño se descarta')
}
ok('solo se adjunta un PDF verdadero y de tamaño de recibo')

// ─── 4. The real API ─────────────────────────────────────────────────────────────────────────────
const fakeAuth: RequestHandler = async (req, res, next) => {
  const session = req.header('x-test-session')
  if (!session) return void res.status(401).json({ error: 'Inicia sesión para continuar' })
  const auth: AuthInfo = { sessionId: session, email: req.header('x-test-email') ?? '', passwordAt: null }
  try {
    await checkAccount(db, auth)
  } catch (err) {
    const e = err as HttpError
    return void res.status(e.status).json({ ...e.extra, error: e.message })
  }
  req.auth = auth
  next()
}
const sentMails: MailMessage[] = []
let failNext: HttpError | null = null
const fakeMailer: Mailer = {
  enabled: true,
  async send(m) {
    if (failNext) {
      const e = failNext
      failNext = null
      throw e
    }
    sentMails.push(m)
  },
}
const appWith = (mailer: Mailer) => {
  const server = createApp(db, fakeAuth, undefined, mailer).listen(0)
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}
await db.tx(refreshCounterPerms)
const { server, base } = appWith(fakeMailer)
const OWNER = { 'x-test-session': 'dev-owner', 'x-test-email': 'dueno@x.com' }
const call = async (base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : {}) as Record<string, any> }
}

// The page behind a link: no sign-in, one receipt at a time, never indexed.
let r = await call(base, 'POST', '/api/recibos/compartir', { saleId }, OWNER)
assert.equal(r.status, 201)
const code = r.body.id as string
assert.match(code, /^[0-9a-f]{32}$/)
r = await call(base, 'GET', `/api/recibo/${code}`)
assert.equal(r.status, 200, 'se abre sin iniciar sesión')
assert.equal(r.body.receipt.total, 7000)
assert.equal(r.headers.get('x-robots-tag'), 'noindex')
assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
assert.equal(r.headers.get('cache-control'), 'no-store')
assert.equal((await call(base, 'GET', `/api/recibo/${'1'.repeat(32)}`)).status, 404)
assert.equal((await call(base, 'GET', '/api/recibo/nada')).status, 404)
assert.equal((await call(base, 'GET', '/api/recibo/')).status, 401, 'no hay forma de listarlos: sin código cae en la API normal, que exige sesión')
await lite.query(`update private.shared_receipts set expires_at = now() - interval '1 minute' where id = $1`, [code])
r = await call(base, 'GET', `/api/recibo/${code}`)
assert.equal(r.status, 410)
assert.match(r.body.error, /venció/)
ok('la página del enlace se abre sin sesión, de a un recibo, sin listado, con noindex y sin referrer')

// Everything else asks for someone who works at the store.
assert.equal((await call(base, 'POST', '/api/recibos/compartir', { saleId })).status, 401)
assert.equal((await call(base, 'POST', '/api/recibos/correo', { saleId, to: 'a@b.co' })).status, 401)
const stranger = { 'x-test-session': 'dev-x', 'x-test-email': 'intruso@x.com' }
assert.equal((await call(base, 'POST', '/api/recibos/compartir', { saleId }, stranger)).status, 403)
assert.equal((await call(base, 'POST', '/api/recibos/correo', { saleId, to: 'a@b.co' }, stranger)).status, 403)
assert.equal(sentMails.length, 0, 'ninguno de esos intentos mandó correo')
for (const bad of [undefined, 0, -1, 'x', 1.5, 999999]) {
  assert.equal((await call(base, 'POST', '/api/recibos/compartir', { saleId: bad }, OWNER)).status, 404, `venta inválida: ${String(bad)}`)
}
ok('compartir y enviar por correo exigen una cuenta de la tienda; una venta inválida da 404')

// The e-mail route.
const sendMail = (body: object) => call(base, 'POST', '/api/recibos/correo', body, OWNER)
for (const bad of [undefined, '', 'sin-arroba', 'a@b', 'a b@c.co', 'a@b.co ,c@d.co', `${'x'.repeat(250)}@b.co`, 42]) {
  assert.equal((await sendMail({ saleId, to: bad })).status, 400, `correo inválido: ${String(bad).slice(0, 20)}`)
}
r = await sendMail({ saleId, to: '  cliente@correo.com ' })
assert.equal(r.status, 200)
assert.equal(sentMails.length, 1)
assert.equal(sentMails[0].to, 'cliente@correo.com')
assert.equal(sentMails[0].fromName, 'Plastimax F.R.', 'el remitente lleva el nombre de la tienda')
assert.ok(sentMails[0].html.includes('$7.000,00'), 'con la venta como está guardada, no como la diga el navegador')
assert.deepEqual(sentMails[0].attachments, [], 'sin PDF, el correo sale igual con el recibo en el cuerpo')
r = await sendMail({ saleId, to: 'cliente@correo.com', pdfBase64: pdfBytes.toString('base64'), total: 1, recibo: { total: 1 } })
assert.equal(r.status, 200)
const att = sentMails[1].attachments![0]
assert.equal(att.contentType, 'application/pdf')
assert.match(att.filename, new RegExp(`^Recibo-${String(saleId).padStart(4, '0')}\\.pdf$`))
assert.ok(att.content.equals(pdfBytes), 'el PDF viaja intacto')
assert.ok(sentMails[1].html.includes('$7.000,00'), 'lo que traiga el navegador de más se ignora')
r = await sendMail({ saleId, to: 'cliente@correo.com', pdfBase64: Buffer.alloc(500, 'x').toString('base64') })
assert.equal(r.status, 200)
assert.deepEqual(sentMails[2].attachments, [], 'lo que no es un PDF no se adjunta')
failNext = new HttpError(502, 'No se pudo enviar el correo. Revisa la dirección e inténtalo de nuevo')
r = await sendMail({ saleId, to: 'cliente@correo.com' })
assert.equal(r.status, 502, 'si Gmail falla, la tienda lo sabe')
assert.equal(sentMails.length, 3)
ok('el correo se arma con la venta guardada, adjunta el PDF solo si es válido y avisa si falla')

// A store without mail set up, and the hourly ceiling.
const noMail = appWith(noMailer)
r = await call(noMail.base, 'POST', '/api/recibos/correo', { saleId, to: 'a@b.co' }, OWNER)
assert.equal(r.status, 503)
assert.match(r.body.error, /no está configurado/)
assert.equal(r.body.down, undefined, 'un 503 de "correo sin configurar" no dice que el servidor esté caído (la app seguiría vendiendo con normalidad)')
assert.equal((await call(noMail.base, 'POST', '/api/recibos/compartir', { saleId }, OWNER)).status, 201, 'y WhatsApp sigue funcionando')
noMail.server.close()

let accepted = sentMails.length
let refused: Awaited<ReturnType<typeof sendMail>> | null = null
while (!refused && accepted < 100) {
  const res = await sendMail({ saleId, to: 'cliente@correo.com' })
  if (res.status === 200) accepted++
  else refused = res
}
assert.equal(refused?.status, 429)
assert.equal(accepted, 40, 'son 40 por hora y por cuenta')
assert.match(refused!.body.error, /demasiados/)
ok('sin correo configurado el servidor lo dice (503) y WhatsApp sigue; cada cuenta puede mandar 40 por hora')

// The open route can't be used to starve the till: one ceiling for everybody, and database errors stay private.
const burst = appWith(noMailer)
let lastStatus = 0
let served = 0
for (let i = 0; i < 100 && lastStatus !== 429; i++) {
  lastStatus = (await call(burst.base, 'GET', `/api/recibo/${'2'.repeat(32)}`)).status
  if (lastStatus === 404) served++
}
assert.equal(lastStatus, 429, 'pasado el tope, la ruta abierta responde 429')
assert.equal(served, 60, 'son 60 lecturas por minuto')
burst.server.close()

const logged = console.error
console.error = () => {}
const brokenDb = { ...db, query: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432') } }
const broken = createApp(brokenDb, fakeAuth, undefined, noMailer).listen(0)
r = await call(`http://127.0.0.1:${(broken.address() as AddressInfo).port}`, 'GET', `/api/recibo/${'3'.repeat(32)}`)
console.error = logged
assert.equal(r.status, 503, 'con la base caída: 503, no 400')
assert.equal(JSON.stringify(r.body).includes('ECONNREFUSED'), false, 'y sin el texto del error interno')
assert.match(r.body.error, /No se pudo cargar el recibo/)
broken.close()
ok('la ruta abierta del recibo tiene un tope por minuto y no muestra los errores de la base de datos')

server.close()
await db.end()
console.log(`\nTodo en orden: ${n} comprobaciones de recibos compartidos pasaron.`)
