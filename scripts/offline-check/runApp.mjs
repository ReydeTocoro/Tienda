// npm run check:offline-app
// The REAL built app, service worker included, in a real browser against the in-memory API and the Supabase stand-in:
// sign in with internet, sell, lose the internet (with the sign-in's access token expired), reload the app without
// internet, sell (cash and fiado) and look at the lists, reload again, and get the internet back — everything kept on
// the device must reach the server exactly once. Then the installed-app variant (Windows .exe / Android .apk): built
// with VITE_PACKAGED=1 and served from a sub-folder, with no server that rewrites routes. Needs Google Chrome.
//   OFFLINE_CHECK_SHOTS=<folder>  also saves screenshots of the main steps there.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { launchChrome, sleep } from './cdp.mjs'
import { PORTS, apiUrl, buildApp, control, startApi, startPreview, stopAll } from './servers.mjs'

const results = []
const check = (label, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ok  ' : '  FALLÓ') + ' ' + label + (cond ? '' : ' ' + JSON.stringify(detail)))
}
const SHOTS = process.env.OFFLINE_CHECK_SHOTS

// Helpers that run in the page.
const setInput = (sel, v) =>
  `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`
const clickText = (text, scope = 'document') =>
  `(()=>{const b=[...${scope}.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true})()`
const goto = (label) => `(()=>{const a=[...document.querySelectorAll('a')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(label)}));if(!a)return false;a.click();return true})()`
const clickLeaf = (text) => `(()=>{const el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim().includes(${JSON.stringify(text)}));if(!el)return false;el.click();return true})()`
const pillIs = (re) => `[...document.querySelectorAll('button')].some(b=>${re}.test(b.getAttribute('aria-label')||''))`
const idb = (store) =>
  `new Promise((res,rej)=>{const r=indexedDB.open('tienda-pro');r.onsuccess=()=>{const db=r.result;if(![...db.objectStoreNames].includes(${JSON.stringify(store)})){db.close();return res([])}const q=db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll();q.onsuccess=()=>{db.close();res(q.result)};q.onerror=()=>rej(q.error)};r.onerror=()=>rej(r.error)})`

/** Types a code in the search box of Venta, charges the cart and returns what the receipt says. */
async function sellByCode(c, code, { fiado } = {}) {
  const { ev, send, waitFor } = c
  await ev(setInput('#venta-search-input', code))
  await ev("document.querySelector('#venta-search-input').focus()")
  await sleep(300)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  if (!(await waitFor("document.body.innerText.includes('Carrito') && !document.body.innerText.includes('Carrito vacío')", 8000)).ok) return { ok: false, step: 'carrito' }
  await ev(clickText('Cobrar'))
  if (!(await waitFor("!!document.querySelector('dialog[open]') && !!document.querySelector('dialog[open] button[data-enter]')", 8000)).ok) return { ok: false, step: 'hoja de cobro' }
  if (fiado) {
    await ev(clickText('Fiado', "document.querySelector('dialog[open]')"))
    await sleep(300)
    await ev(`(()=>{const el=[...document.querySelectorAll('dialog[open] input')].find(i=>i.placeholder.includes('fías'));if(!el)return false;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,${JSON.stringify(fiado)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
    await sleep(200)
  }
  if (!fiado) await ev(clickText('Exacto', "document.querySelector('dialog[open]')")) // a cash sale needs what the customer paid with
  await ev(clickText('Confirmar cobro', "document.querySelector('dialog[open]')"))
  const w = await waitFor("document.body.innerText.includes('RECIBO PROVISIONAL') || document.body.innerText.includes('RECIBO DE VENTA')", 15000)
  const text = await ev('document.body.innerText')
  return { ok: w.ok, provisional: text.includes('RECIBO PROVISIONAL'), text }
}
/** Opens "Cerrar caja" from the user's menu; returns what the sheet says and whether its confirm button is disabled. */
async function openCierre(c) {
  const { ev, waitFor } = c
  await ev(`document.querySelector('button[aria-haspopup="menu"]').click()`)
  await sleep(300)
  const found = await ev(`(()=>{const b=[...document.querySelectorAll('[role=menuitem]')].find(x=>x.textContent.trim().startsWith('Cerrar caja'));if(!b)return false;b.click();return true})()`)
  if (!found) return { found: false }
  await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Reporte Z')", 8000)
  await sleep(400)
  return {
    found: true,
    text: await ev(`document.querySelector('dialog[open]')?.innerText||''`),
    confirmDisabled: await ev(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim().startsWith('Confirmar Cierre Z'))?.disabled`),
  }
}
const closeSheet = async (c) => {
  await c.ev(clickText('Cerrar', "document.querySelector('dialog[open]')"))
  await sleep(400)
}
const shot = (c, name) => (SHOTS ? c.shot(path.join(SHOTS, name + '.png')) : undefined)
/** The store's day in the page, like todayKey(). */
const TODAY_IN_PAGE = "new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())"

async function mainFlow(appUrl, webDir) {
  await control('/__test/reset', {})
  await control('/__test/supa', { down: false, accessTtl: 3600 })
  const c = await launchChrome()
  const { ev, send, waitFor } = c
  try {
    // 1. Sign in, with internet.
    await send('Page.navigate', { url: appUrl })
    check('1 aparece la pantalla de ingreso', (await waitFor(`!!document.querySelector('#login-email')`, 30000)).ok)
    // Today's "Pendientes de hoy" counts as seen, so it doesn't open in the middle of the steps below (step 12 is about it).
    await ev(`localStorage.setItem('mtp-daily-notices', JSON.stringify({ owner: ${TODAY_IN_PAGE} }))`)
    await ev(setInput('#login-email', 'dueno@x.com'))
    await ev(setInput('#login-password', 'clave123'))
    await ev(clickText('Ingresar'))
    check('1 entra a Venta con su cuenta', (await waitFor(`!!document.querySelector('#venta-search-input')`, 30000)).ok)
    check('1 los productos se descargan al equipo', (await waitFor(`document.body.innerText.includes('Balde')`, 30000)).ok, (await ev('document.body.innerText')).slice(0, 300))
    await shot(c, '01-venta-con-internet')
    check('1 con internet no hay indicador de conexión', (await ev(pillIs('/Sin conexión|Enviando|rechazada/'))) === false)

    // 1b. Selling with internet works as ever.
    let sale = await sellByCode(c, 'A1')
    check('1b con internet se cobra normal: recibo de venta con número definitivo', sale.ok && !sale.provisional && /RECIBO DE VENTA #\d{4}/.test(sale.text), sale.text?.slice(0, 200))
    const st1 = await control('/__test/state')
    check('1b el servidor tiene la venta (no marcada sin internet) y el stock bajó a 49', st1.sales.length === 1 && !st1.sales[0].offline && st1.sales[0].clientId && st1.stocks.A1 === 49, st1)
    await closeSheet(c)
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input')", 30000)
    check('1b tras recargar el equipo ve el stock nuevo (49)', (await waitFor("(()=>{const row=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='A1');return !!row&&document.body.innerText.includes('49')})()", 20000)).ok)

    // 1c. "Cambiar de usuario" with internet: the next person gets the login — the stored sign-in that lets the app
    // open without internet must be gone, or the app would let the same person straight back in.
    await ev(`document.querySelector('button[aria-haspopup="menu"]').click()`)
    await sleep(300)
    await ev(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim().startsWith('Cambiar de usuario')).click()`)
    await waitFor("!!document.querySelector('dialog[open]')", 5000)
    await ev(clickText('Cerrar sesión', "document.querySelector('dialog[open]')"))
    check('1c "Cambiar de usuario" con internet deja el ingreso para quien sigue (no vuelve a entrar solo)', (await waitFor("!!document.querySelector('#login-email')", 15000)).ok)
    await sleep(800)
    check('1c y no queda la sesión guardada en el equipo', (await ev("!Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k))")) === true)
    check('1c ni se coló dentro de la aplicación', (await ev("!document.querySelector('#venta-search-input')")) === true)
    await ev(setInput('#login-email', 'dueno@x.com'))
    await ev(setInput('#login-password', 'clave123'))
    await ev(clickText('Ingresar'))
    check('1c quien sigue entra con su cuenta', (await waitFor("!!document.querySelector('#venta-search-input')", 30000)).ok)
    await waitFor("document.body.innerText.includes('Balde')", 30000)

    // 1d. The search box of Venta narrows the table of products itself — no dropdown — and marks what was typed.
    const key = (k, code) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }))
    await ev(setInput('#venta-search-input', 'bal'))
    await ev("document.querySelector('#venta-search-input').focus()")
    await sleep(500)
    check('1d escribir no abre ninguna tabla de resultados aparte', (await ev("!document.body.innerText.includes('resultado') && !document.body.innerText.includes('navegar')")) === true)
    check('1d la lista de productos queda solo con lo que coincide', (await ev("(()=>{const t=document.querySelector('[role=table]');return t.querySelectorAll('[role=row]').length===2 && t.innerText.includes('Balde') && !t.innerText.includes('Ponchera')})()")) === true, await ev("document.querySelector('[role=table]').innerText"))
    const marks = await ev("[...document.querySelectorAll('[role=table] mark')].map(m=>({t:m.textContent,bg:getComputedStyle(m).backgroundColor}))")
    check('1d lo escrito se resalta en amarillo en la lista (código, nombre o marca)', marks.length >= 1 && marks.every((m) => m.t.toLowerCase() === 'bal' && m.bg === 'rgb(254, 228, 54)'), marks)
    await shot(c, '00-busqueda-resaltada')
    // The keyboard still works: Enter marks the first row, ↓ walks down, Enter takes it.
    await ev(setInput('#venta-search-input', 'e'))
    await sleep(400)
    await key('Enter', 13)
    await sleep(300)
    await key('ArrowDown', 40)
    await key('ArrowDown', 40)
    await sleep(300)
    check('1d con el teclado: Enter marca una fila y las flechas se mueven por la lista', (await ev("(()=>{const r=[...document.querySelectorAll('[role=table] [role=row]')].filter(x=>x.className.includes('ring-lime'));return r.length===1&&r[0].innerText.includes('Ponchera')})()")) === true)
    await key('Enter', 13)
    await sleep(500)
    check('1d y Enter la pasa al carrito y limpia la búsqueda', (await ev("document.body.innerText.includes('Ponchera') && document.querySelector('#venta-search-input').value===''")) === true && (await ev("document.body.innerText.includes('Carrito vacío')")) === false)
    // (a reload leaves the cart empty again for what follows)
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input') && document.body.innerText.includes('Balde')", 30000)

    // 1e. A cash sale can't be charged without saying what the customer paid with, and the bills add up.
    await ev(setInput('#venta-search-input', 'A1'))
    await ev("document.querySelector('#venta-search-input').focus()")
    await sleep(300)
    await key('Enter', 13)
    await waitFor("document.body.innerText.includes('Carrito') && !document.body.innerText.includes('Carrito vacío')", 8000)
    // 1e0. The quantity of a line can be typed over (not only − and +).
    const qtyBox = "document.querySelector('input[aria-label=\"Cantidad de Balde\"]')"
    const typeQty = async (v) => {
      await ev(`${qtyBox}.focus()`)
      await ev(setInput('input[aria-label="Cantidad de Balde"]', v))
      await ev(`${qtyBox}.blur()`)
      await sleep(250)
    }
    await typeQty('3')
    check('1e escribir 3 en la cantidad deja 3 y el total de la venta sube a 6.000', (await ev(`${qtyBox}.value`)) === '3' && (await ev("document.body.innerText.includes('$6.000,00')")) === true, await ev(`${qtyBox}.value`))
    await typeQty('9999')
    check('1e escribir más de lo que hay se queda en el stock y avisa', Number(await ev(`${qtyBox}.value`)) <= 60 && Number(await ev(`${qtyBox}.value`)) > 3 && (await ev("document.body.innerText.includes('Stock máximo alcanzado')")) === true, await ev(`${qtyBox}.value`))
    await typeQty('0')
    check('1e escribir 0 no quita ni cambia la línea', Number(await ev(`${qtyBox}.value`)) > 3)
    await typeQty('1')
    check('1e y se puede volver a 1 escribiéndolo', (await ev(`${qtyBox}.value`)) === '1')
    await ev(clickText('Cobrar'))
    const confirmBtn = "[...document.querySelectorAll('dialog[open] button')].find(b=>b.hasAttribute('data-enter'))"
    const received = "[...document.querySelectorAll('dialog[open] input')].find(i=>i.placeholder==='0').value.replace(/\\./g,'')"
    const bill = (v) => `(()=>{const b=[...document.querySelectorAll('dialog[open] button')].find(x=>(x.getAttribute('aria-label')||'').startsWith('$${v},'));if(!b)return false;b.click();return true})()`
    await waitFor(`!!${confirmBtn}`, 8000)
    check('1e sin decir con cuánto paga, "Confirmar cobro" está apagado y lo pide', (await ev(`${confirmBtn}.disabled && ${confirmBtn}.textContent.includes('Indica con cuánto paga')`)) === true, await ev(`${confirmBtn}.textContent`))
    await key('Enter', 13)
    await sleep(500)
    check('1e Enter tampoco cobra sin ese valor', (await ev("!!document.querySelector('dialog[open]')")) === true && (await control('/__test/state')).sales.length === 1)
    await ev(bill('1.000'))
    check('1e un billete de 1.000 no alcanza para 2.000: dice cuánto falta y sigue apagado', (await ev(`${confirmBtn}.disabled && ${confirmBtn}.textContent.includes('Falta')`)) === true, await ev(`${confirmBtn}.textContent`))
    await ev(bill('1.000'))
    check('1e el mismo billete otra vez se suma (2.000) y ya se puede cobrar', (await ev(`${received}`)) === '2000' && (await ev(`!${confirmBtn}.disabled`)) === true, await ev(`${received}`))
    await ev(bill('5.000'))
    await ev(bill('2.000'))
    check('1e billetes distintos también se suman (1.000 + 1.000 + 5.000 + 2.000 = 9.000) y muestra el cambio', (await ev(`${received}`)) === '9000' && (await ev("document.querySelector('dialog[open]').innerText.includes('Cambio a devolver')")) === true, await ev(`${received}`))
    await shot(c, '11-billetes-suman')
    await ev(clickText('Borrar', "document.querySelector('dialog[open]')"))
    await sleep(300)
    check('1e "Borrar" deja el efectivo en cero y vuelve a pedirlo', (await ev(`${confirmBtn}.disabled && ${confirmBtn}.textContent.includes('Indica con cuánto paga')`)) === true)
    await ev(bill('50.000'))
    await ev(`document.querySelector('dialog[open] button[aria-label="Cerrar"]').click()`)
    await sleep(500)
    await ev(clickText('Cobrar'))
    await waitFor(`!!${confirmBtn}`, 8000)
    check('1e al volver a abrir Cobrar empieza de cero (no suma lo de antes)', (await ev(`${confirmBtn}.disabled`)) === true && ['', '0'].includes(await ev(`${received}`)), await ev(`${received}`))
    await ev(clickText('Exacto', "document.querySelector('dialog[open]')"))
    check('1e "Exacto" pone el total y habilita el cobro', (await ev(`!${confirmBtn}.disabled`)) === true && (await ev(`${received}`)) === '2000')
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input') && document.body.innerText.includes('Balde')", 30000)

    // 2. The service worker holds the whole app.
    check('2 el service worker está listo', (await waitFor(`navigator.serviceWorker.ready.then(()=>true)`, 30000)).ok)
    check('2 la aplicación (con tipografías) quedó guardada para usarse sin internet', (await waitFor(`caches.keys().then(async ks=>{for(const k of ks){const n=(await (await caches.open(k)).keys()).length;if(n>=30)return n}return 0})`, 30000)).ok)

    // 3. The internet goes away. The sign-in's access token has expired meanwhile.
    await ev(`(()=>{const k=Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/.test(k));const s=JSON.parse(localStorage.getItem(k));s.expires_at=Math.floor(Date.now()/1000)-7200;localStorage.setItem(k,JSON.stringify(s));return k})()`)
    await c.setNetwork(true)
    await control('/__test/mode', { kind: 'down' })
    await control('/__test/supa', { down: true })

    // 4. The app is opened again without internet.
    const t0 = Date.now()
    await send('Page.reload')
    const opened = await waitFor(`!!document.querySelector('#venta-search-input')`, 40000)
    check(`4 sin internet y con la sesión vencida, la app abre en Venta (${((Date.now() - t0) / 1000).toFixed(1)} s)`, opened.ok && Date.now() - t0 < 15000, { opened, body: (await ev('document.body.innerText')).slice(0, 300) })
    check('4 y no pide iniciar sesión', (await ev(`!!document.querySelector('#login-email')`)) === false)
    check('4 los productos siguen ahí', (await waitFor(`document.body.innerText.includes('Balde')`, 15000)).ok)
    check('4 el indicador avisa "Sin conexión"', (await waitFor(pillIs('/Sin conexión/'), 20000)).ok)
    await shot(c, '02-arranque-sin-internet')
    check('4 las tipografías están disponibles sin internet', (await ev(`document.fonts.check('16px "IBM Plex Sans"') && document.fonts.check('12px "IBM Plex Mono"')`)) === true)

    // 5. Sell without internet.
    sale = await sellByCode(c, 'A1')
    check('5 se cobra y sale un recibo PROVISIONAL', sale.ok && sale.provisional, sale.text?.slice(0, 300))
    await sleep(400)
    await shot(c, '03-recibo-provisional')
    check('5 el recibo provisional no ofrece Correo/WhatsApp', (await ev(`[...document.querySelectorAll('dialog[open] button')].some(b=>/^(Correo|WhatsApp)/.test(b.textContent.trim()))`)) === false)
    const ob = await ev(idb('outbox'))
    check('5 la venta quedó en la cola del equipo', ob.length === 1 && ob[0].status === 'pending', ob)
    const a1 = (await ev(idb('products'))).find((p) => p.code === 'A1')
    check('5 el inventario local bajó (48) recordando el del servidor (49)', a1 && a1.stock === 48 && a1.serverStock === 49, a1)
    check('5 aparece en las ventas locales con número PEND', (await ev(idb('sales'))).some((s) => s.id < 0 && s.refLocal && s.pendingSync))
    check('5 el servidor no supo nada (sigue con la venta de antes)', (await control('/__test/state')).sales.length === 1)
    await closeSheet(c)
    check('5 el indicador cuenta 1 venta por enviar', (await waitFor(pillIs('/Sin conexión · 1/'), 8000)).ok)
    await ev(`[...document.querySelectorAll('button')].filter(b=>/Sin conexión/.test(b.getAttribute('aria-label')||'')).find(b=>b.offsetParent!==null).click()`)
    await sleep(600)
    await shot(c, '04-ventas-pendientes')
    check('5 la hoja de ventas pendientes lista la venta', (await ev(`document.querySelector('dialog[open]')?.innerText||''`)).includes('PEND-'))
    await ev(clickText('Cerrar', "document.querySelector('dialog[open]')"))

    // 5b. In Facturas the pending sale is flagged and cannot be corrected.
    await ev(goto('Facturas'))
    check('5b Facturas muestra la venta con su número PEND y el estado "Por enviar"', (await waitFor("document.body.innerText.includes('PEND-0001') && document.body.innerText.includes('Por enviar')", 10000)).ok, (await ev('document.body.innerText')).slice(0, 400))
    const pencils = await ev("[...document.querySelectorAll('button[aria-label=\"Corregir factura\"]')].length")
    check('5b la venta pendiente no ofrece "Corregir" (la normal sí)', pencils === 1, { pencils })

    // 5c. A fiado without internet is listed, but cannot be collected until it is sent.
    await ev(goto('Venta'))
    await waitFor("!!document.querySelector('#venta-search-input')", 8000)
    sale = await sellByCode(c, 'B2', { fiado: 'Doña Marta' })
    check('5c un fiado sin internet también sale con recibo provisional', sale.ok && sale.provisional && sale.text.includes('Fiado: Doña Marta'), sale.text?.slice(0, 300))
    await closeSheet(c)
    await ev(goto('Fiados'))
    check('5c el deudor aparece en Fiados', (await waitFor("document.body.innerText.includes('Doña Marta')", 10000)).ok)
    await ev(clickLeaf('Doña Marta'))
    const detail = await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Por enviar al servidor')", 8000)
    const payButtons = await ev("[...document.querySelectorAll('dialog[open] button')].some(b=>/^(Abonar|Pagar|Condonar)/.test(b.textContent.trim()))")
    check('5c su detalle dice que se podrá cobrar cuando se envíe, sin botones de pago', detail.ok && payButtons === false, await ev("document.querySelector('dialog[open]')?.innerText||''"))
    await closeSheet(c)
    check('5c ya son dos ventas pendientes', (await ev(idb('outbox'))).length === 2)

    // 5d. Changing user needs the internet (the next person's password is checked online): it says so and nobody is
    // locked out of the till.
    await ev(`document.querySelector('button[aria-haspopup="menu"]').click()`)
    await sleep(300)
    await ev(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim().startsWith('Cambiar de usuario')).click()`)
    await waitFor("!!document.querySelector('dialog[open]')", 5000)
    await ev(clickText('Cerrar sesión', "document.querySelector('dialog[open]')"))
    check('5d sin internet "Cambiar de usuario" lo explica y la persona sigue dentro', (await waitFor("document.body.innerText.includes('No se pudo cerrar la sesión')", 20000)).ok && (await ev("!document.querySelector('#login-email')")) === true, (await ev('document.body.innerText')).slice(0, 300))

    // 5d2. The day can't be closed while sales made without internet are still on this device.
    const cierre = await openCierre(c)
    check('5d el Cierre Z espera a las ventas sin enviar: lo dice y no deja confirmar', cierre.found && cierre.text.includes('todavía no llegaron al servidor') && cierre.confirmDisabled === true, cierre)
    await ev(clickText('Cancelar', "document.querySelector('dialog[open]')"))
    await sleep(400)

    // 5e. "Cerrar sesión y borrar" would lose the sales waiting to be sent: it refuses.
    await ev("history.pushState({}, '', '/configuracion?seccion=dispositivo'); dispatchEvent(new PopStateEvent('popstate'))")
    check('5e abre Configuración → Este dispositivo', (await waitFor("document.body.innerText.includes('Dejar de usar este dispositivo')", 10000)).ok)
    await ev(clickText('Cerrar sesión y borrar'))
    await waitFor("!!document.querySelector('dialog[open]')", 5000)
    await ev(clickText('Cerrar sesión y borrar', "document.querySelector('dialog[open]')"))
    check('5e con ventas sin enviar se niega y explica por qué (no se pierde nada)', (await waitFor("document.body.innerText.includes('todavía no llegaron al servidor')", 15000)).ok, (await ev('document.body.innerText')).slice(0, 300))
    check('5e y las ventas siguen guardadas', (await ev(idb('outbox'))).length === 2)
    await ev(goto('Fiados'))

    // 6. Reload again, still without internet, on a page other than the first.
    await send('Page.reload')
    const again = await waitFor(`location.pathname==='/fiados' && document.body.innerText.includes('Sin conexión') && document.body.innerText.includes('Doña Marta')`, 40000)
    check('6 recargar otra vez sin internet (estando en Fiados) vuelve a abrir la app en esa misma página', again.ok, { path: await ev('location.pathname') })
    check('6 y las ventas pendientes siguen guardadas', (await ev(idb('outbox'))).length === 2)
    await sleep(1500)

    // 7. The internet is back.
    await c.setNetwork(false)
    await control('/__test/mode', { kind: 'ok' })
    await control('/__test/supa', { down: false })
    const back = Date.now()
    const gone = await waitFor(`!(${pillIs('/Sin conexión|Enviando|rechazada/')})`, 150000)
    check(`7 al volver el internet las ventas se envían solas y el indicador desaparece (${((Date.now() - back) / 1000).toFixed(1)} s)`, gone.ok)
    const st = await control('/__test/state')
    check('7 el servidor tiene las dos ventas hechas sin internet (marcadas) y la normal', st.sales.length === 3 && st.sales.filter((x) => x.offline).length === 2 && st.sales.some((x) => x.payMethod === 'fiado' && x.fiadoName === 'Doña Marta'), st.sales)
    check('7 el stock del servidor quedó (A1 48, B2 2) y la caja se movió dos veces (el fiado no mueve caja)', st.stocks.A1 === 48 && st.stocks.B2 === 2 && st.movements === 2, st)
    check('7 la cola quedó vacía', (await ev(idb('outbox'))).length === 0)
    const sales = await ev(idb('sales'))
    check('7 las provisionales se reemplazaron por las reales', sales.length === 3 && sales.every((x) => x.id > 0 && !x.pendingSync), sales.map((x) => x.id))
    const a1b = (await ev(idb('products'))).find((p) => p.code === 'A1')
    check('7 el stock local quedó en 48 sin marcas', a1b && a1b.stock === 48 && a1b.serverStock === undefined, a1b)
    await shot(c, '05-con-internet-otra-vez')

    // 8. A sale the server refused waits for a person: it is shown in red, can be retried or thrown away, and holds no stock.
    await ev(`new Promise((res, rej) => { const r = indexedDB.open('tienda-pro'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('outbox', 'readwrite'); const soldAt = new Date().toISOString(); tx.objectStore('outbox').add({ clientId: 'rechazada-0000000000000001', createdAt: soldAt, status: 'rejected', attempts: 1, lastError: 'La venta no tiene forma de pago', payload: { clientId: 'rechazada-0000000000000001', soldAt, localRef: 'PEND-0099', items: [{ code: 'A1', name: 'Balde', price: 2000, qty: 1, brand: '', unit: 'unidad', isFree: false }], subtotal: 2000, discount: 0, total: 2000, payMethod: 'efectivo' } }); tx.oncomplete = () => { db.close(); res(true) }; tx.onerror = () => rej(tx.error) }; r.onerror = () => rej(r.error) })`)
    await send('Page.reload')
    check('8 una venta que el servidor rechazó se avisa en rojo aunque haya internet', (await waitFor(pillIs('/1 rechazada/'), 30000)).ok)
    await shot(c, '06-venta-rechazada')
    const cierre2 = await openCierre(c)
    check('8 el Cierre Z tampoco deja cerrar con una venta rechazada sin resolver', cierre2.found && cierre2.text.includes('El servidor rechazó 1 venta') && cierre2.confirmDisabled === true, cierre2)
    await ev(clickText('Cancelar', "document.querySelector('dialog[open]')"))
    await sleep(400)
    await ev(`[...document.querySelectorAll('button')].filter(b=>/rechazada/.test(b.getAttribute('aria-label')||'')).find(b=>b.offsetParent!==null).click()`)
    await sleep(500)
    const sheet = await ev(`document.querySelector('dialog[open]')?.innerText||''`)
    check('8 la hoja la lista con el motivo y las dos salidas: reintentar o descartar', sheet.includes('PEND-0099') && sheet.includes('El servidor no la aceptó') && sheet.includes('Reintentar') && sheet.includes('Descartar'), sheet)
    await ev(clickText('Descartar', "document.querySelector('dialog[open]')"))
    await sleep(500)
    await ev(clickText('Descartar', "document.querySelectorAll('dialog[open]')[document.querySelectorAll('dialog[open]').length - 1]"))
    check('8 descartarla (con confirmación) la borra del equipo', (await waitFor("true", 1000)).ok && (await waitFor(`new Promise((res) => { const r = indexedDB.open('tienda-pro'); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').count(); q.onsuccess = () => { r.result.close(); res(q.result === 0) } } })`, 8000)).ok)
    check('8 y el indicador desaparece', (await waitFor(`!(${pillIs('/Sin conexión|Enviando|rechazada/')})`, 8000)).ok)
    // 9. Fixing and annulling an invoice from Facturas, with internet: the inventory and the caja follow every change.
    const setArea = (sel, v) => `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const d=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');d.set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`
    const rowButton = (number, label) => `(()=>{const r=[...document.querySelectorAll('[role=row]')].find(x=>x.innerText.includes(${JSON.stringify(number)}));const b=r?.querySelector('button[aria-label="${label}"]');if(!b)return false;b.click();return true})()`
    const dialogText = () => ev("document.querySelector('dialog[open]')?.innerText||''")
    const keyOf = (k, code) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }))
    if (await ev("!!document.querySelector('dialog[open]')")) await closeSheet(c) // the sheet of sales waiting, still open from step 8
    // The stand-in of Supabase has no Realtime push: a reload is what brings what the server did back to this device.
    const refresh = async (what) => {
      await send('Page.reload')
      await waitFor("document.querySelectorAll('[role=row]').length>1", 30000)
      const ok = (await waitFor(`new Promise((res)=>{const r=indexedDB.open('tienda-pro');r.onsuccess=()=>{const q=r.result.transaction('sales').objectStore('sales').getAll();q.onsuccess=()=>{r.result.close();res((${what})(q.result))}}})`, 15000)).ok
      await sleep(800) // and the table on screen catches up with it (a live query re-renders a moment later)
      return ok
    }
    await ev(goto('Facturas'))
    check('9 Facturas lista las tres ventas, cada una con Corregir y Anular', (await waitFor("document.querySelectorAll('button[aria-label=\"Corregir factura\"]').length===3 && document.querySelectorAll('button[aria-label=\"Anular factura\"]').length===3", 15000)).ok)
    const before9 = await control('/__test/state')
    const venta1 = before9.sales.find((x) => x.items.length === 1 && x.items[0].code === 'A1' && !x.offline)
    const num1 = '#' + String(venta1.id).padStart(4, '0')
    check('9 punto de partida: A1 en 48 y B2 en 2', before9.stocks.A1 === 48 && before9.stocks.B2 === 2, before9.stocks)

    // 9a. Correct it: more Baldes and a Ponchera chosen from the suggestions while typing.
    check('9a se abre la corrección de la factura ' + num1, (await ev(rowButton(num1, 'Corregir factura'))) === true && (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Corregir Factura')", 8000)).ok)
    await ev("document.querySelector('dialog[open] [role=combobox]').focus()")
    await ev(setInput('dialog[open] [role=combobox]', 'pon'))
    await sleep(400)
    const sug = await ev("document.querySelector('dialog[open] [role=listbox]')?.innerText||''")
    check('9a al escribir sugiere los productos del inventario que coinciden (y solo ellos)', sug.includes('Ponchera') && !sug.includes('Balde') && !sug.includes('Cuerda'), sug)
    const marks9 = await ev("[...document.querySelectorAll('dialog[open] [role=listbox] mark')].map(m=>m.textContent.toLowerCase())")
    check('9a lo escrito se resalta en amarillo en las sugerencias', marks9.length >= 1 && marks9.every((m) => m === 'pon'), marks9)
    await shot(c, '07-corregir-sugerencias')
    await keyOf('Enter', 13)
    await sleep(500)
    const afterPick = await dialogText()
    check('9a Enter elige la sugerencia (no guarda la corrección): queda la línea de Ponchera y la hoja sigue abierta', afterPick.includes('Corregir Factura') && afterPick.includes('Ponchera') && (await ev("document.querySelector('dialog[open] [role=combobox]').value===''")) === true, afterPick.slice(0, 500))
    await ev(setInput('dialog[open] input[aria-label="Cantidad de Balde"]', '3'))
    await sleep(300)
    const preview = await dialogText()
    check('9a antes de guardar dice qué pasará: Balde −2 y Ponchera −1 del inventario, y cuánto recibe la Caja Menor', /Balde[\s\S]*−2 sale del inventario/.test(preview) && /Ponchera[\s\S]*−1 sale del inventario/.test(preview) && preview.includes('La Caja Menor recibe'), preview)
    await shot(c, '08-corregir-efecto')
    await ev(clickText('Guardar corrección', "document.querySelector('dialog[open]')"))
    await sleep(500)
    check('9a sin motivo no guarda: la hoja sigue abierta y el servidor no cambió', (await dialogText()).includes('Corregir Factura') && (await control('/__test/state')).stocks.A1 === 48)
    await ev(setArea('dialog[open] textarea', 'el cliente llevó más'))
    await ev(clickText('Guardar corrección', "document.querySelector('dialog[open]')"))
    check('9a al guardar la hoja se cierra', (await waitFor("!document.querySelector('dialog[open]')", 15000)).ok)
    const after9a = await control('/__test/state')
    const v1a = after9a.sales.find((x) => x.id === venta1.id)
    check('9a el servidor descontó lo nuevo del inventario (A1 46, B2 1) y la factura quedó en 11.000 corregida', after9a.stocks.A1 === 46 && after9a.stocks.B2 === 1 && v1a.total === 11000 && v1a.corrected === true, { stocks: after9a.stocks, total: v1a.total })
    check('9a la caja registró el ajuste (un movimiento más)', after9a.movements === before9.movements + 1, { antes: before9.movements, ahora: after9a.movements })

    check('9a con el equipo al día, la factura local ya muestra la corrección', await refresh(`(rows)=>rows.some((x)=>x.id===${venta1.id}&&x.total===11000)`))

    // 9b. Correct it again: asking for more than there is is refused on screen; taking the Ponchera out gives it back.
    await ev(rowButton(num1, 'Corregir factura'))
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Corregir Factura')", 8000)
    await ev(setInput('dialog[open] input[aria-label="Cantidad de Ponchera"]', '5'))
    await sleep(300)
    const blocked = await dialogText()
    check('9b pedir más de lo que hay lo dice (hay 2 para esta factura) y no deja guardar', blocked.includes('Solo hay 2 disponibles') && (await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim().startsWith('Guardar corrección')).disabled")) === true, blocked.slice(0, 600))
    await ev("document.querySelector('dialog[open] button[aria-label=\"Quitar Ponchera\"]').click()")
    await sleep(300)
    const gives = await dialogText()
    check('9b quitar la Ponchera dice que 1 vuelve al inventario y el botón se habilita', /Ponchera[\s\S]*\+1 vuelve al inventario/.test(gives) && (await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim().startsWith('Guardar corrección')).disabled")) === false, gives.slice(0, 600))
    await ev(setArea('dialog[open] textarea', 'se devolvió la ponchera'))
    await ev(clickText('Guardar corrección', "document.querySelector('dialog[open]')"))
    await waitFor("!document.querySelector('dialog[open]')", 15000)
    const after9b = await control('/__test/state')
    check('9b la Ponchera volvió al inventario (B2 2), A1 sigue en 46 y la factura quedó en 6.000', after9b.stocks.B2 === 2 && after9b.stocks.A1 === 46 && after9b.sales.find((x) => x.id === venta1.id).total === 6000, { stocks: after9b.stocks })

    check('9b con el equipo al día, la factura local quedó en 6.000', await refresh(`(rows)=>rows.some((x)=>x.id===${venta1.id}&&x.total===6000)`))

    // 9c. Annul it: everything goes back.
    check('9c se abre "Anular factura"', (await ev(rowButton(num1, 'Anular factura'))) === true && (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Anular Factura')", 8000)).ok)
    const voidText = await dialogText()
    check('9c dice qué pasará: 3 Baldes vuelven al inventario y salen $6.000 de la Caja Menor', /Balde[\s\S]*\+3 vuelve al inventario/.test(voidText) && /Salen \$\s?6\.000[\s\S]*Caja Menor/.test(voidText), voidText)
    await shot(c, '09-anular')
    await ev(clickText('Anular factura', "document.querySelector('dialog[open]')"))
    await sleep(500)
    check('9c sin motivo no anula', (await dialogText()).includes('Anular Factura') && !(await control('/__test/state')).sales.find((x) => x.id === venta1.id).voided)
    await ev(setArea('dialog[open] textarea', 'venta hecha por error'))
    await ev(clickText('Anular factura', "document.querySelector('dialog[open]')"))
    check('9c al anular la hoja se cierra', (await waitFor("!document.querySelector('dialog[open]')", 15000)).ok)
    const after9c = await control('/__test/state')
    const v1c = after9c.sales.find((x) => x.id === venta1.id)
    check('9c el servidor la marcó anulada, con motivo, y devolvió todo al inventario (A1 49, B2 2)', v1c.voided === true && v1c.voidReason === 'venta hecha por error' && after9c.stocks.A1 === 49 && after9c.stocks.B2 === 2, { v: v1c, stocks: after9c.stocks })
    check('9c y sacó el dinero de la caja (un movimiento más)', after9c.movements === after9b.movements + 1, { antes: after9b.movements, ahora: after9c.movements })

    check('9c con el equipo al día, la factura local quedó anulada', await refresh(`(rows)=>rows.some((x)=>x.id===${venta1.id}&&x.voided===true)`))

    // 9d. What Facturas shows afterwards.
    check('9d la factura sigue en la lista, marcada "Anulada", sin botones de corregir ni anular', (await waitFor(`(()=>{const r=[...document.querySelectorAll('[role=row]')].find(x=>x.innerText.includes(${JSON.stringify(num1)}));return !!r&&r.innerText.includes('Anulada')&&!r.querySelector('button[aria-label="Corregir factura"]')&&!r.querySelector('button[aria-label="Anular factura"]')})()`, 15000)).ok, await ev('document.body.innerText.slice(0,500)'))
    const chips = await ev("document.body.innerText")
    check('9d el total de ventas no suma la anulada (quedan 2.000 + 5.000)', /Ventas\s+\$\s?7\.000/.test(chips), chips.slice(0, 400))
    await shot(c, '10-factura-anulada')
    await ev(`(()=>{const r=[...document.querySelectorAll('[role=row]')].find(x=>x.innerText.includes(${JSON.stringify(num1)}));r.click()})()`)
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('FACTURA ANULADA')", 8000)
    const receipt9 = await dialogText()
    check('9d el recibo de una anulada lo dice, con el motivo, y no ofrece compartir, corregir ni anular', receipt9.includes('FACTURA ANULADA') && receipt9.includes('venta hecha por error') && !/Correo|WhatsApp|Compartir PDF|Corregir esta|Anular esta/.test(receipt9), receipt9.slice(0, 500))
    await closeSheet(c)
    check('9d con el equipo recargado se sigue viendo anulada (viene del servidor)', (await ev(idb('sales'))).find((x) => x.id === venta1.id)?.voided === true)

    // 9f. What each sale earned is a column of Facturas (the owner may see profits), and every correction and annulment
    // is in "Correcciones y anulaciones" — all of them, with what changed, why and who did it.
    const headers9 = await ev("[...document.querySelectorAll('[role=columnheader]')].map(h=>h.innerText.trim())")
    check('9f Facturas tiene la columna Ganancia (el dueño ve las ganancias)', headers9.includes('Ganancia'), headers9)
    const gananciaPorFila = await ev(`(()=>{const i=[...document.querySelectorAll('[role=columnheader]')].findIndex(h=>h.innerText.trim()==='Ganancia');return [...document.querySelectorAll('[role=row]')].slice(1).map(r=>[r.querySelectorAll('[role=cell]')[0]?.innerText.trim(),r.querySelectorAll('[role=cell]')[i]?.innerText.trim()])})()`)
    check('9f cada venta que cuenta muestra su ganancia y la anulada muestra "—"', gananciaPorFila.length >= 3 && gananciaPorFila.every(([n, g]) => (n === num1 ? g === '—' : /^[$].?-?[0-9]/.test(g))), gananciaPorFila)
    await shot(c, '10b-facturas-ganancia')
    await ev(clickText('Correcciones y anulaciones'))
    check('9f el botón "Correcciones y anulaciones" abre el historial', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Correcciones y anulaciones de facturas')", 8000)).ok)
    const hist = await dialogText()
    const pos = (s) => hist.indexOf(s)
    check('9f lista la anulación y las dos correcciones de esa factura, de la más reciente a la más antigua', pos('venta hecha por error') > -1 && pos('se devolvió la ponchera') > pos('venta hecha por error') && pos('el cliente llevó más') > pos('se devolvió la ponchera'), hist)
    check('9f cada una dice qué cambió (antes y después) y quién lo hizo', /Antes.{1,3}[$].?11[.]000[^]*después.{1,3}[$].?6[.]000/.test(hist) && /Anuló: [^ ]/.test(hist) && /Corrigió: [^ ]/.test(hist) && !hist.includes('sin registrar'), hist)
    await sleep(400) // let the sheet finish opening before the picture
    await shot(c, '10c-historial-correcciones')
    await ev(setInput('dialog[open] input[aria-label="Buscar"]', 'ponchera'))
    await sleep(300)
    const soloUna = await dialogText()
    check('9f buscar por motivo deja solo esa corrección', soloUna.includes('se devolvió la ponchera') && !soloUna.includes('venta hecha por error') && !soloUna.includes('el cliente llevó más'), soloUna)
    await ev(setInput('dialog[open] input[aria-label="Buscar"]', 'zzzz'))
    await sleep(300)
    check('9f si nada coincide lo dice', (await dialogText()).includes('Nada coincide con la búsqueda'))
    await ev("document.querySelector('dialog[open] button[aria-label=\"Cerrar\"]').click()")
    check('9f el historial se cierra con su X', (await waitFor("!document.querySelector('dialog[open]')", 8000)).ok)

    // 9e. A transfer says which account it came into (Nequi / Bancolombia), and the day's close shows them apart.
    await ev(goto('Venta'))
    await waitFor("!!document.querySelector('#venta-search-input')", 10000)
    await ev(setInput('#venta-search-input', 'A1'))
    await ev("document.querySelector('#venta-search-input').focus()")
    await sleep(300)
    await keyOf('Enter', 13)
    await waitFor("document.body.innerText.includes('Carrito') && !document.body.innerText.includes('Carrito vacío')", 8000)
    await ev(clickText('Cobrar'))
    await waitFor("!!document.querySelector('dialog[open] button[data-enter]')", 8000)
    await ev(clickText('Transfer.', "document.querySelector('dialog[open]')"))
    await sleep(300)
    const mainBtn = "[...document.querySelectorAll('dialog[open] button')].find(b=>b.hasAttribute('data-enter'))"
    const radios = "[...document.querySelectorAll('dialog[open] [role=radio]')]"
    check('9e al elegir transferencia pregunta la cuenta, con los íconos de Nequi y Bancolombia', (await ev(`${radios}.length === 2 && ${radios}.every(r => !!r.querySelector('img')) && ${radios}[0].innerText.includes('Nequi') && ${radios}[1].innerText.includes('Bancolombia')`)) === true, await ev(`${radios}.map(r=>r.innerText)`))
    check('9e los íconos de verdad cargaron (no son imágenes rotas)', (await ev(`${radios}.every(r => r.querySelector('img').complete && r.querySelector('img').naturalWidth > 0)`)) === true)
    check('9e sin elegir cuenta no se puede cobrar: "Elige la cuenta"', (await ev(`${mainBtn}.disabled && ${mainBtn}.textContent.includes('Elige la cuenta')`)) === true, await ev(`${mainBtn}.textContent`))
    await keyOf('Enter', 13)
    await sleep(400)
    check('9e Enter tampoco cobra sin cuenta', (await ev("!!document.querySelector('dialog[open]')")) === true)
    await shot(c, '12-transferencia-cuenta')
    await ev(`${radios}[0].click()`)
    await sleep(300)
    check('9e al elegir Nequi se habilita el cobro', (await ev(`!${mainBtn}.disabled && ${radios}[0].getAttribute('aria-checked') === 'true'`)) === true)
    const transfersBefore = await control('/__test/state')
    await ev(clickText('Confirmar cobro', "document.querySelector('dialog[open]')"))
    await waitFor("document.body.innerText.includes('RECIBO DE VENTA')", 15000)
    const rcpt = await ev('document.body.innerText')
    check('9e el recibo dice "Transferencia · Nequi"', rcpt.includes('Transferencia · Nequi'), rcpt.slice(0, 300))
    const afterT = await control('/__test/state')
    const lastSale = afterT.sales[afterT.sales.length - 1]
    check('9e el servidor guardó la venta con su cuenta (nequi) y la caja la recibió en la Mayor', lastSale.payMethod === 'transferencia' && lastSale.transferAccount === 'nequi' && afterT.movements === transfersBefore.movements + 1, lastSale)
    await closeSheet(c)
    await refresh('(rows)=>rows.some((x)=>x.transferAccount===\'nequi\')')
    const cz = await openCierre(c)
    check('9e el Cierre Z muestra lo que entró por cada cuenta (Nequi con la venta de 2.000)', cz.found && cz.text.includes('Transferencias por cuenta') && /Nequi[\s\S]*2\.000/.test(cz.text), cz.text)
    await shot(c, '13-cierre-por-cuenta')
    await ev(clickText('Cancelar', "document.querySelector('dialog[open]')"))
    await sleep(400)

    // 9f. A discount in money on one product of the sale — no percentages.
    await ev(goto('Venta'))
    await waitFor("!!document.querySelector('#venta-search-input')", 10000)
    await ev(setInput('#venta-search-input', 'A1'))
    await ev("document.querySelector('#venta-search-input').focus()")
    await sleep(300)
    await keyOf('Enter', 13)
    await waitFor("document.body.innerText.includes('Carrito') && !document.body.innerText.includes('Carrito vacío')", 8000)
    await ev(clickText('Cobrar'))
    await waitFor("!!document.querySelector('dialog[open] button[data-enter]')", 8000)
    await ev(`document.querySelector('dialog[open] button[title="Descuento en dinero"]').click()`)
    const top = "[...document.querySelectorAll('dialog[open]')].pop()"
    await waitFor(`(${top}.innerText||'').includes('Descuento en dinero')`, 8000)
    await sleep(300)
    const dtext = await ev(`${top}.innerText`)
    check('9f el descuento ya no es en porcentajes: se ve el producto y se escribe un valor en dinero', dtext.includes('Balde') && dtext.includes('Valor del descuento') && !/\b(5|10|15|20|25|30|50)%/.test(dtext), dtext)
    check('9f con un solo producto ya viene elegido', (await ev(`${top}.querySelector('[role=radio]').getAttribute('aria-checked')`)) === 'true')
    await shot(c, '14-descuento-en-dinero')
    await ev(setInput('#discount-amount', '5000'))
    await sleep(300)
    check('9f no deja descontar más de lo que vale la línea (2.000) y no aplica', (await ev(`${top}.innerText.includes('No puede pasar de') && [...${top}.querySelectorAll('button')].find(b=>b.hasAttribute('data-enter')).disabled`)) === true, await ev(`${top}.innerText`))
    await ev(setInput('#discount-amount', '500'))
    await sleep(300)
    await ev(clickText('Aplicar descuento', top))
    await sleep(500)
    const sheet9f = await ev("document.querySelector('dialog[open]')?.innerText||''")
    check('9f al aplicarlo, el cobro muestra el descuento (−$500) y el total baja a 1.500', (await ev("document.querySelectorAll('dialog[open]').length")) === 1 && sheet9f.includes('Descuento') && sheet9f.includes('-$500,00') && (await ev("document.querySelector('#charge-input').value")) === '1.500', sheet9f.slice(0, 400))
    await ev(clickText('Exacto', "document.querySelector('dialog[open]')"))
    const before9f = await control('/__test/state')
    await ev(clickText('Confirmar cobro', "document.querySelector('dialog[open]')"))
    await waitFor("document.body.innerText.includes('RECIBO DE VENTA')", 15000)
    const rcpt9f = await ev('document.body.innerText')
    check('9f el recibo dice a qué producto se le descontó', rcpt9f.includes('Desc. −$500,00') && rcpt9f.includes('1.500'), rcpt9f.slice(0, 300))
    const after9f = await control('/__test/state')
    const sale9f = after9f.sales[after9f.sales.length - 1]
    check('9f el servidor guardó el descuento en la venta (500, total 1.500) y en la línea del producto', after9f.sales.length === before9f.sales.length + 1 && sale9f.discount === 500 && sale9f.total === 1500 && sale9f.items[0].discount === 500, sale9f)
    await closeSheet(c)

    // 9g. No loyalty program: customers have no points, no levels and no automatic discount anywhere.
    const NO_LOYALTY = /Puntos|Nivel|Bronce|Plata|\bOro\b|\bpts\b|Descuento disponible/i
    await ev(goto('Clientes'))
    check('9g la lista de clientes no tiene columnas ni filtros de puntos o niveles', (await waitFor("document.body.innerText.includes('Ana Gómez')", 10000)).ok && !NO_LOYALTY.test(await ev('document.body.innerText')), (await ev('document.body.innerText')).slice(0, 500))
    await ev(clickLeaf('Ana Gómez'))
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Cliente desde')", 8000)
    const profile = await ev("document.querySelector('dialog[open]')?.innerText||''")
    check('9g el perfil del cliente no habla de puntos ni de niveles, y sí de lo que ha comprado', profile.includes('Compras') && profile.includes('Promedio') && !NO_LOYALTY.test(profile), profile)
    await closeSheet(c)
    await ev(goto('Venta'))
    await waitFor("!!document.querySelector('#venta-search-input')", 10000)
    await ev(`document.querySelector('button[title="Seleccionar cliente"]').click()`)
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Seleccionar Cliente')", 8000)
    const picker = await ev("document.querySelector('dialog[open]')?.innerText||''")
    check('9g al elegir cliente en la venta tampoco se ven puntos ni niveles', picker.includes('Ana Gómez') && !NO_LOYALTY.test(picker), picker)
    await closeSheet(c)

    // 9h. "Producto sin registrar", from the cart: a typed name and price, charged like any line, and no stock moves.
    await ev(`document.querySelector('dialog[open] button[aria-label="Cerrar"]')?.click()`) // the customer picker of 9g is still open
    await waitFor("!document.querySelector('dialog[open]')", 5000)
    await ev(clickText('Producto sin registrar'))
    const top9h = "[...document.querySelectorAll('dialog[open]')].pop()"
    check('9h el botón del carrito abre "Producto sin registrar"', (await waitFor(`(${top9h}?.innerText||'').includes('No está en el inventario')`, 8000)).ok, await ev('document.body.innerText.slice(0, 300)'))
    check('9h sin nombre ni precio no deja agregarlo', (await ev(`${top9h}.querySelector('button[data-enter]').disabled`)) === true)
    await ev(setInput('#free-name', 'Bolsa especial'))
    await ev(setInput('#free-price', '2500'))
    await ev(setInput('#free-qty', '2'))
    await sleep(300)
    await ev(clickText('Agregar al carrito', top9h))
    await waitFor("!document.querySelector('dialog[open]')", 5000)
    const cart9h = await ev('document.body.innerText')
    check('9h queda en el carrito marcado LIBRE, sin código, por 2 × 2.500', cart9h.includes('Bolsa especial') && cart9h.includes('LIBRE') && cart9h.includes('Sin registrar') && cart9h.includes('5.000'), cart9h.slice(0, 600))
    await shot(c, '14b-producto-sin-registrar')
    const before9h = await control('/__test/state')
    await ev(clickText('Cobrar'))
    await waitFor("!!document.querySelector('dialog[open] button[data-enter]')", 8000)
    await ev(clickText('Exacto', "document.querySelector('dialog[open]')"))
    await ev(clickText('Confirmar cobro', "document.querySelector('dialog[open]')"))
    const rcpt9h = (await waitFor("document.body.innerText.includes('RECIBO DE VENTA')", 15000)).ok ? await ev('document.body.innerText') : ''
    check('9h se cobra y el recibo lo trae como [Libre]', rcpt9h.includes('Bolsa especial') && rcpt9h.includes('[Libre]'), rcpt9h.slice(0, 400))
    const after9h = await control('/__test/state')
    const sale9h = after9h.sales[after9h.sales.length - 1]
    check(
      '9h el servidor guardó la línea libre (2 × 2.500) sin tocar el stock',
      after9h.sales.length === before9h.sales.length + 1 && sale9h.items.length === 1 && sale9h.items[0].isFree === true && sale9h.items[0].code.startsWith('FREE_') && sale9h.total === 5000 && JSON.stringify(after9h.stocks) === JSON.stringify(before9h.stocks),
      { sale9h, stocks: [before9h.stocks, after9h.stocks] },
    )
    await closeSheet(c)

    // 9i. "Cambiar mi contraseña" asks for the password the account has now before it changes anything.
    await ev(`document.querySelector('button[aria-haspopup="menu"]').click()`)
    await sleep(300)
    await ev(`[...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('Cambiar mi contraseña'))?.click()`)
    check('9i el formulario pide primero la contraseña actual', (await waitFor("!!document.querySelector('dialog[open] #current-password')", 8000)).ok)
    const updates = async () => (await control('/__test/supa', {})).passwordUpdates
    const alertText = async () => ev(`document.querySelector('dialog[open] [role=alert]')?.innerText || ''`)
    const submitPw = async () => {
      await ev(clickText('Cambiar contraseña', "document.querySelector('dialog[open]')"))
      await sleep(900)
    }
    const fillPw = async (cur, nuevo) => {
      await ev(setInput('#current-password', cur))
      await ev(setInput('#new-password', nuevo))
      await ev(setInput('#new-password2', nuevo))
    }
    const n9i = (await updates()).length
    await submitPw()
    check('9i sin la actual no cambia nada y lo dice', (await alertText()).includes('Escribe tu contraseña actual') && (await updates()).length === n9i, await alertText())
    await fillPw('equivocada-1', 'nueva-clave-2026')
    await submitPw()
    check('9i con una actual equivocada la rechaza y no cambia nada', (await alertText()).includes('La contraseña actual no es correcta') && (await updates()).length === n9i, await alertText())
    await fillPw('clave123', 'clave123')
    await submitPw()
    check('9i una nueva igual a la actual tampoco pasa', (await alertText()).includes('distinta a la actual') && (await updates()).length === n9i, await alertText())
    await fillPw('clave123', 'nueva-clave-2026')
    await submitPw()
    const sent9i = await updates()
    check('9i con la actual correcta cambia la contraseña (y se la manda a Supabase, que también la revisa)', sent9i.length === n9i + 1 && sent9i[n9i].password === 'nueva-clave-2026' && sent9i[n9i].current_password === 'clave123', sent9i)
    check('9i y cierra el formulario con el aviso', (await waitFor("!document.querySelector('dialog[open]')", 5000)).ok && (await ev("document.body.innerText.includes('Contraseña cambiada')")) === true)

    // 10. A newer version is published while the app is open: it restarts by itself — but not in the middle of a sale.
    await ev(`document.querySelector('dialog[open] button[aria-label="Cerrar"]')?.click()`)
    await waitFor("!document.querySelector('dialog[open]')", 5000)
    const scriptOf = "[...document.scripts].map((s) => s.src).find((u) => /assets\\/index-[^/]+\\.js$/.test(u))"
    const v1 = await ev(scriptOf)
    await ev('window.__sigueAqui = 1')
    await ev(setInput('#venta-search-input', 'A1'))
    await ev("document.querySelector('#venta-search-input').focus()")
    await sleep(300)
    await keyOf('Enter', 13)
    await waitFor("document.body.innerText.includes('Carrito') && !document.body.innerText.includes('Carrito vacío')", 8000)
    buildApp(webDir, { key: 'anon-test-v2' }) // "publishes" the new version
    await ev('navigator.serviceWorker.getRegistration().then((r) => r.update())')
    const heard = await waitFor("document.body.innerText.includes('Hay una versión nueva')", 25000)
    await sleep(12000) // longer than the time between two looks: it must still be waiting
    check('10 con una venta a medias la app avisa que hay una versión nueva y NO se reinicia (sigue la misma página)', heard.ok && (await ev('window.__sigueAqui')) === 1, { heard, aqui: await ev('window.__sigueAqui') })
    check('10 y el carrito sigue como estaba', (await ev("!!document.querySelector('button[aria-label=\"Quitar del carrito\"]')")) === true)
    await ev(`document.querySelector('button[aria-label="Quitar del carrito"]').click()`)
    const restarted = await waitFor("window.__sigueAqui === undefined && !!document.querySelector('#venta-search-input')", 40000)
    check('10 al quedar el carrito vacío se reinicia sola y trae la versión nueva', restarted.ok && (await ev(scriptOf)) !== v1, { v1, ahora: await ev(scriptOf) })

    // 11. The eye of the Caja Mayor: closed, it shows nothing of the Mayor and lets nothing move into it; opening asks for a PIN.
    const jsonPost = (route, body) => fetch(apiUrl() + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.text())
    await jsonPost('/api/counter/owner-pin', { pin: '4821', pinLength: 4 })
    await jsonPost('/api/cash/transfer', { from: 'menor', to: 'mayor', amount: 1000 }) // so the Mayor has something to hide
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input')", 30000)
    await ev(goto('Cajas'))
    await waitFor("document.body.innerText.includes('Caja Mayor')", 15000)
    const mayorCard = "[...document.querySelectorAll('section')].find((x) => x.innerText.startsWith('Caja Mayor'))"
    const eye = "document.querySelector('button[aria-label*=\"la Caja Mayor\"]')"
    const typePin = async (pin) => {
      for (const d of pin) {
        await keyOf(d, 48 + Number(d))
        await sleep(80)
      }
    }
    const mayorText = async () => ev(`${mayorCard}.innerText`)
    const closedText = await mayorText()
    check('11 la Caja Mayor empieza cerrada: sin saldo ni cifras (solo ••••••)', closedText.includes('••••••') && !/\$/.test(closedText), closedText)
    await shot(c, '16-caja-mayor-cerrada')
    const body11 = await ev('document.body.innerText')
    check('11 y sus movimientos no se ven (el traslado aparece solo del lado de la Caja Menor)', body11.includes('Traslado a Caja Mayor') && !body11.includes('Traslado desde Caja Menor'), body11.slice(0, 600))
    check('11 la lista de movimientos no trae ventas ni abonos (eso es de Facturas y Fiados), aunque hoy hubo varias', !/Venta #[0-9]|Abono de fiado|Corrección de venta/.test(body11), body11.slice(0, 600))
    await ev(clickText('Reporte X'))
    check('11 Cajas ofrece el Reporte X: abre la lectura parcial del día', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('LECTURA PARCIAL')", 8000)).ok)
    const x11 = await ev("document.querySelector('dialog[open]')?.innerText||''")
    check('11 trae transacciones, ventas brutas, flujo neto y se puede imprimir', /Transacciones/.test(x11) && /Ventas brutas/.test(x11) && /FLUJO NETO/.test(x11) && /Imprimir/.test(x11), x11)
    await sleep(400)
    await shot(c, '16b-reporte-x')
    await ev(clickText('Cerrar', "document.querySelector('dialog[open]')"))
    await sleep(400)
    check('11 y la caja sigue abierta: no se cerró nada', (await ev("!document.querySelector('dialog[open]') && document.body.innerText.includes('Cerrar caja (Cierre Z)')")) === true)
    await ev(clickText('Trasladar a Caja Mayor'))
    await sleep(400)
    check('11 con la Caja Mayor cerrada no deja trasladar: avisa y no abre nada', (await ev("!document.querySelector('dialog[open]')")) === true && (await ev("document.body.innerText.includes('La Caja Mayor está cerrada')")) === true)
    await ev(clickText('Registrar egreso'))
    await sleep(300)
    check('11 tampoco deja registrar egresos ni ingresos de la Caja Mayor', (await ev("!document.querySelector('dialog[open]')")) === true)
    await ev(`${eye}.click()`)
    check('11 el ojito pide el PIN', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Abrir la Caja Mayor')", 8000)).ok)
    await typePin('0000')
    check('11 un PIN equivocado no la abre', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('PIN incorrecto')", 8000)).ok && (await mayorText()).includes('••••••'))
    await typePin('4821')
    check('11 con el PIN correcto se abre y muestra su saldo', (await waitFor(`!document.querySelector('dialog[open]') && !(${mayorCard}.innerText.includes('••••••'))`, 10000)).ok && /Saldo\n\$\d/.test(await mayorText()), await mayorText())
    check('11 y sus movimientos aparecen', (await ev("document.body.innerText.includes('Traslado desde Caja Menor')")) === true)
    await shot(c, '15-caja-mayor-abierta')
    await ev(clickText('Trasladar a Caja Mayor'))
    check('11 abierta, sí deja trasladar', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Trasladar fondos')", 8000)).ok)
    await ev(clickText('Cancelar', "document.querySelector('dialog[open]')"))
    await sleep(500)
    await ev(`${eye}.click()`)
    await sleep(400)
    check('11 el ojito la vuelve a cerrar: otra vez sin cifras', (await mayorText()).includes('••••••') && !/\$/.test(await mayorText()))
    // The closing of the day: its transfer to the Caja Mayor needs it open too.
    await ev(clickText('Cerrar caja'))
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Reporte Z')", 8000)
    await ev(setInput('dialog[open] input[placeholder="0"]', '1000'))
    await sleep(400)
    const cz2 = await ev("document.querySelector('dialog[open]')?.innerText||''")
    check('11 el Cierre Z con la Caja Mayor cerrada no ofrece trasladar: lo explica', cz2.includes('Caja Mayor cerrada') && (await ev("document.querySelector('dialog[open] input[type=checkbox]').checked")) === false, cz2)
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()")
    await sleep(300)
    check('11 y la casilla de trasladar no se deja marcar', (await ev("document.querySelector('dialog[open] input[type=checkbox]').checked")) === false)
    check('11 el aviso dice que este cierre no trasladará nada y trae el botón para abrir la Caja Mayor ahí mismo', cz2.includes('este cierre no trasladará nada') && cz2.includes('mañana al abrir saldrá como faltante') && cz2.includes('Abrir Caja Mayor'), cz2)
    await sleep(300)
    await shot(c, '16c-cierre-mayor-cerrada')

    // 11d. The cash can't just be left in the books: with nothing moved to the Caja Mayor the closing asks to be told that it
    // stays in the drawer (the cash that left unrecorded is what became a "faltante" the next day).
    const sentCierres = async () => (await control('/__test/state')).requests['POST /api/cierres'] ?? 0
    const sent0 = await sentCierres()
    const stays = "[...document.querySelectorAll('dialog[open] input[type=checkbox]')][1]"
    check('11d con efectivo contado y nada que trasladar, el cierre trae la casilla "se queda en el cajón", sin marcar', cz2.includes('se queda en el cajón') && (await ev(`${stays}?.checked`)) === false, cz2)
    await ev(`${stays}?.scrollIntoView({ block: 'center' })`)
    await sleep(300)
    await shot(c, '16g-cierre-sin-trasladar')
    await ev(clickText('Confirmar Cierre Z', "document.querySelector('dialog[open]')"))
    check('11d sin marcarla no cierra: avisa, la hoja sigue abierta y no se pidió nada al servidor', (await waitFor("document.body.innerText.includes('qué pasa con el efectivo')", 5000)).ok && (await ev("!!document.querySelector('dialog[open]')")) === true && (await sentCierres()) === sent0, { sent0, ahora: await sentCierres() })
    await ev(`${stays}.click()`)
    await sleep(300)
    check('11d la casilla se marca', (await ev(`${stays}?.checked`)) === true)
    // Ticked, the request goes out — the stand-in refuses it on purpose, so the day is not really closed.
    await control('/__test/mode', { kind: 'status', status: 409, path: '/api/cierres', times: 1 })
    await ev(clickText('Confirmar Cierre Z', "document.querySelector('dialog[open]')"))
    let went = false
    for (let i = 0; i < 20 && !went; i++) {
      went = (await sentCierres()) > sent0
      if (!went) await sleep(250)
    }
    check('11d marcada, la petición del cierre sí sale', went, { sent0, ahora: await sentCierres() })
    await control('/__test/mode', {})
    await ev(clickText('Abrir Caja Mayor', "document.querySelector('dialog[open]')"))
    check('11 ese botón pide el PIN', (await waitFor("[...document.querySelectorAll('dialog[open]')].some(d => d.innerText.includes('Abrir la Caja Mayor'))", 8000)).ok)
    await typePin('4821')
    check(
      '11 con el PIN la Caja Mayor se abre dentro del cierre: desaparece el aviso y ya ofrece trasladar (casilla marcada)',
      (await waitFor("(()=>{const d=[...document.querySelectorAll('dialog[open]')].find(x=>x.innerText.includes('Reporte Z'));return !!d && !d.innerText.includes('este cierre no trasladará nada') && d.querySelector('input[type=checkbox]')?.checked === true})()", 10000)).ok,
      await ev("[...document.querySelectorAll('dialog[open]')].map(d=>d.innerText).join(' --- ')"),
    )
    await ev(clickText('Cancelar', "document.querySelector('dialog[open]')"))
    await sleep(400)
    await ev(`${eye}.click()`) // the eye as it was: closed
    await sleep(400)
    // Reporte only reports: no list of the day's sales, no Reporte X / Z, no gasto button (Cajas has them).
    await ev(goto('Reporte'))
    await waitFor("document.body.innerText.includes('Historial de cierres')", 15000)
    const rep = await ev('document.body.innerText')
    check('11 Reporte muestra solo reportes: sin lista de ventas, sin Reporte X ni Z, sin botón de gasto', rep.includes('Flujo neto del día') && !/Ventas del período|Reporte X|Cierre definitivo de caja|Registrar gasto|CORRECCIONES DE FACTURAS/i.test(rep), rep.slice(0, 600))
    await ev(goto('Cajas'))
    await waitFor("document.body.innerText.includes('Movimientos')", 15000)

    // 11b. Opening the caja with a gap against the books: the person says where the base came from (or where the cash
    // went). The store's routine: everything goes to the Caja Mayor at closing and a base comes back every morning —
    // which used to be booked as a "sobrante" while the Caja Mayor kept counting that cash.
    const before11b = await control('/__test/state')
    const today11b = await ev(TODAY_IN_PAGE)
    await jsonPost('/api/cierres', { dayKey: today11b, cajero: 'Propietario', notas: '', efectivoFisico: before11b.cash.menor, trasladar: before11b.cash.menor })
    const closed11b = await control('/__test/state')
    check('11b el cierre llevó todo a la Caja Mayor: la Menor quedó en 0', closed11b.cash.menor === 0 && closed11b.cash.mayor === before11b.cash.mayor + before11b.cash.menor, { antes: before11b.cash, ahora: closed11b.cash })
    const base11b = 3000
    check('11b (la Caja Mayor tiene con qué poner la base)', closed11b.cash.mayor >= base11b, closed11b.cash)
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input')", 30000)
    await ev(goto('Cajas'))
    check('11b con la caja cerrada se ofrece "Abrir caja"', (await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim().startsWith('Abrir caja'))", 15000)).ok)
    await ev(clickText('Abrir caja'))
    check('11b se abre la hoja de apertura', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Abrir Caja Menor')", 8000)).ok)
    const aperturaSheet = "document.querySelector('dialog[open]')"
    // First a base bigger than what the Caja Mayor holds…
    await ev(setInput('dialog[open] input[placeholder="0"]', String(closed11b.cash.mayor + 1000)))
    check('11b al contar más de lo que dice el sistema pregunta de dónde salió ese efectivo', (await waitFor(`(${aperturaSheet}?.innerText||'').includes('¿De dónde salió ese efectivo?')`, 8000)).ok, await ev(`${aperturaSheet}?.innerText||''`))
    check('11b y no deja abrir mientras no se elija una opción', (await ev(clickText('Abrir caja', aperturaSheet))) === false)
    await sleep(400)
    await shot(c, '16d-abrir-caja-eligiendo')
    await ev(clickText('Lo saqué de la Caja Mayor', aperturaSheet))
    check('11b elegir la Caja Mayor pide el PIN (está cerrada)', (await waitFor("[...document.querySelectorAll('dialog[open]')].some(d => d.innerText.includes('Abrir la Caja Mayor'))", 8000)).ok)
    await typePin('4821')
    check(
      '11b ya abierta, ve que la Mayor no tiene tanto: apaga esa opción y sigue sin dejar abrir',
      (await waitFor("[...document.querySelectorAll('[role=radio]')].some(r => r.disabled && r.innerText.includes('solo tiene'))", 10000)).ok && (await ev(clickText('Abrir caja', aperturaSheet))) === false,
      await ev(`${aperturaSheet}?.innerText||''`),
    )
    // …and then a base the Caja Mayor can give.
    await ev(setInput('dialog[open] input[placeholder="0"]', String(base11b)))
    check('11b con una base que sí alcanza, la opción se enciende', (await waitFor("[...document.querySelectorAll('[role=radio]')].some(r => !r.disabled && r.innerText.includes('Lo saqué de la Caja Mayor'))", 8000)).ok)
    await ev(clickText('Lo saqué de la Caja Mayor', aperturaSheet))
    check('11b y queda elegida (sin pedir otro PIN: la Mayor ya está abierta)', (await waitFor("[...document.querySelectorAll('[role=radio][aria-checked=true]')].some(r => r.innerText.includes('Lo saqué de la Caja Mayor'))", 8000)).ok)
    await sleep(300)
    await shot(c, '16e-abrir-caja-de-la-mayor')
    await ev(clickText('Abrir caja', aperturaSheet))
    check('11b y la caja se abre', (await waitFor("!document.querySelector('dialog[open]')", 15000)).ok)
    const open11b = await control('/__test/state')
    const rows11b = open11b.ledger.slice(closed11b.ledger.length)
    check(
      '11b el servidor anotó un traslado de la Caja Mayor a la Menor por la base (sin sobrante ni ajuste de arqueo)',
      rows11b.length === 2 && rows11b.every((m) => m.type.startsWith('traslado') && m.amount === base11b) && rows11b.some((m) => m.caja === 'mayor' && m.direction === 'out') && rows11b.some((m) => m.caja === 'menor' && m.direction === 'in' && /base al abrir caja/.test(m.concept)),
      rows11b,
    )
    check('11b y las dos cajas cuadran: la Menor tiene la base y la Mayor la misma cantidad menos', open11b.cash.menor === base11b && open11b.cash.mayor === closed11b.cash.mayor - base11b, open11b.cash)

    await ev(`${eye}.click()`) // the eye as it was: closed
    await sleep(400)

    // 11c. "Abrió con": what the workday was opened with is kept in sight — on the Caja Menor card, in the Reporte X and
    // in the Cierre Z — so the expected cash (base + what came in − what went out) can be followed all day.
    // (The stand-in plays no Realtime: a reload brings what the opening wrote.)
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input')", 30000)
    await ev(goto('Cajas'))
    check('11c la tarjeta de la Caja Menor dice con cuánto se abrió', (await waitFor("/Abrió con[^$]*[$]3[.]000,00/.test(document.body.innerText)", 8000)).ok, (await ev('document.body.innerText')).slice(0, 500))
    await sleep(300)
    await shot(c, '16f-abrio-con')
    await ev(clickText('Reporte X'))
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('LECTURA PARCIAL')", 8000)
    const x11c = await ev("document.querySelector('dialog[open]')?.innerText||''")
    check('11c el Reporte X empieza por "Abrió con (base)" y la cifra', /Abrió con [(]base[)][^$]*[$]3[.]000,00/.test(x11c) && x11c.indexOf('Abrió con') < x11c.indexOf('Transacciones'), x11c.slice(0, 400))
    await ev(clickText('Cerrar', "document.querySelector('dialog[open]')"))
    await sleep(400)
    const z11c = await openCierre(c)
    check('11c el Cierre Z muestra con cuánto se abrió junto al efectivo esperado', z11c.found && /Abrió con[^$]*[$]3[.]000,00/.test(z11c.text), z11c.text?.slice(0, 500))
    await ev(clickText('Cancelar', "document.querySelector('dialog[open]')"))
    await sleep(400)

    // 12. The notices: "Pendientes de hoy" opens by itself once a day per person and the bell opens it again; after 3
    // minutes without use the rest screen comes up — and the input that wakes it never reaches the page behind.
    const jsonSend = (method, route, body) => fetch(apiUrl() + route, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.text())
    await jsonSend('POST', '/api/products', { code: 'N1', name: 'Jarra', price: 3000, stock: 2, min: 5, cat: '', brand: '', unit: 'unidad', esPaquete: false })
    await jsonSend('POST', '/api/products', { code: 'N2', name: 'Vaso', price: 1000, stock: 0, min: 4, cat: '', brand: '', unit: 'unidad', esPaquete: false })
    // Goods received on credit (one due within the week, one later) and an order sent but not received yet.
    const buyOnCredit = async (name, days, line, receive = true) => {
      const supplier = JSON.parse(await jsonSend('POST', '/api/suppliers', { name, paymentTerms: { kind: 'credito', days } }))
      const order = JSON.parse(await jsonSend('POST', '/api/purchaseOrders', { supplierId: supplier.id, lines: [line], send: true }))
      if (receive) await jsonSend('POST', `/api/purchaseOrders/${order.id}/receive`, { payment: { mode: 'credito' } })
    }
    await buyOnCredit('Distribuidora Andina', 3, { code: 'C3', qty: 10, unitCost: 2500 })
    await buyOnCredit('Plásticos del Valle', 30, { code: 'A1', qty: 20, unitCost: 1200 })
    await buyOnCredit('Hogar y Más', 15, { code: 'B2', qty: 5, unitCost: 3000 }, false)
    await ev(goto('Venta'))
    await waitFor("!!document.querySelector('#venta-search-input')", 8000)
    const bell = `[...document.querySelectorAll('button[aria-label="Notificaciones"]')].find((b) => b.offsetParent !== null)`
    // The device downloads them first (the stand-in plays no Realtime): the daily sheet reads what is on the device.
    await send('Page.reload')
    await waitFor(`(${idb('products')}).then((ps) => ps.some((p) => p.code === 'N2'))`, 30000)
    // The new page clears the mark before the app starts: cleared from the old page, that page could still show the
    // sheet (and mark the day again) in the moment before the reload takes it away.
    const clearMark = await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.removeItem('mtp-daily-notices')" })
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input')", 30000)
    const daily = await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Pendientes de hoy')", 20000)
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clearMark.result.identifier })
    const dailyText = await dialogText()
    check('12 la primera vez del día "Pendientes de hoy" se abre sola con el detalle', daily.ok && dailyText.includes('Productos agotados') && dailyText.includes('Vaso') && dailyText.includes('Stock bajo') && dailyText.includes('Quedan 2 · mínimo 5'), dailyText)
    check('12 con lo que se debe a cada proveedor y cuándo vence, y el pedido por recibir', /Pagos a proveedores[\s\S]*\$49\.000,00/.test(dailyText) && /Distribuidora Andina[\s\S]*Vence en 3 días[\s\S]*\$25\.000,00/.test(dailyText) && dailyText.includes('Pedidos por recibir') && dailyText.includes('Hogar y Más'), dailyText)
    check('12 y queda anotado para esta persona y este día', (await ev(`JSON.parse(localStorage.getItem('mtp-daily-notices')||'{}').owner === ${TODAY_IN_PAGE}`)) === true)
    // The system's monthly payment (day 13) is reminded to the Administrador from the 11th to the 13th: what this run
    // sees depends on the real date (check:notices covers every date).
    const reminderDue = await ev(`(() => { const d = Number(${TODAY_IN_PAGE}.slice(8)); return d >= 11 && d <= 13 })()`)
    if (reminderDue) {
      check('12 del 11 al 13 el pago mensual del sistema va primero, con "si ya pagaste, omite este mensaje"', /^Pendientes de hoy\s*[^\n]*\n\s*Pago mensual del sistema/.test(dailyText) && dailyText.includes('Si ya pagaste, omite este mensaje.'), dailyText)
      const t1 = await ev("document.querySelector('dialog[open] [role=timer]')?.innerText")
      await sleep(1300)
      const t2 = await ev("document.querySelector('dialog[open] [role=timer]')?.innerText")
      check('12 y una cuenta regresiva que corre', !!t1 && !!t2 && t1 !== t2, { t1, t2 })
    } else check('12 fuera del 11 al 13 no hay recordatorio del pago mensual', !dailyText.includes('Pago mensual del sistema'), dailyText)
    await shot(c, '17-pendientes-de-hoy')
    const urgent = reminderDue ? '4' : '3'
    check('12 la campana cuenta lo que pide atención: agotados (rojo), stock bajo, un pago de esta semana (y el pago mensual)', (await ev(`(${bell})?.innerText.trim() === '${urgent}' && !!(${bell}).querySelector('.bg-red')`)) === true, await ev(`(${bell})?.outerHTML`))
    await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
    await sleep(400)
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input')", 30000)
    await sleep(9000)
    check('12 el mismo día no vuelve a abrirse sola', (await ev("!document.querySelector('dialog[open]')")) === true, await dialogText())
    await ev(`(${bell}).click()`)
    check('12 la campana la abre cuando uno quiera', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Pendientes de hoy')", 5000)).ok)
    await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
    await sleep(400)

    // The rest screen. The page's clock is pushed forward instead of waiting 3 minutes.
    const rest = "document.querySelector('[aria-label=\"Pantalla de reposo\"]')"
    const skipAhead = () => ev('(() => { window.__realNow ??= Date.now; window.__ahead = (window.__ahead || 0) + 200000; Date.now = () => window.__realNow() + window.__ahead; return true })()')
    await ev("document.querySelector('#venta-search-input').focus()")
    await skipAhead()
    check('12 tras 3 minutos sin uso aparece la pantalla de reposo', (await waitFor(`!!${rest}`, 9000)).ok)
    await sleep(700) // its fade-in
    const restText = await ev(`${rest}.innerText`)
    check('12 lo que se debe a proveedores va en grande, con la cuenta que vence esta semana', /Pendientes por pagar a proveedores\s*\$49\.000,00/i.test(restText) && /Distribuidora Andina\s*#P\d+ · Vence en 3 días/.test(restText), restText)
    check('12 y los demás pendientes al lado', restText.includes('Productos agotados') && restText.includes('Stock bajo') && restText.includes('Pedidos por recibir') && restText.includes('Toca la pantalla'), restText)
    if (reminderDue) check('12 el pago mensual del sistema arriba de todo, con su cuenta regresiva', /pago mensual del sistema/i.test(restText) && restText.search(/pago mensual del sistema/i) < restText.search(/pendientes por pagar/i) && (await ev(`!!${rest}.querySelector('[role=timer]')`)) === true, restText)
    await shot(c, '18-pantalla-de-reposo')
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    await sleep(700)
    await shot(c, '19-pantalla-de-reposo-celular')
    check('12 en un celular cabe a lo ancho (sin desplazarse de lado)', (await ev(`${rest}.scrollWidth <= ${rest}.clientWidth && document.documentElement.scrollWidth <= innerWidth`)) === true)
    await send('Emulation.clearDeviceMetricsOverride')
    await sleep(700)
    // A barcode reader's burst wakes it and is dropped whole: nothing typed, nothing added to the cart.
    const typeKey = (key, code, vk) =>
      send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : key }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }))
    for (const [key, code, vk] of [['A', 'KeyA', 65], ['1', 'Digit1', 49], ['Enter', 'Enter', 13]]) await typeKey(key, code, vk)
    await sleep(700)
    check('12 una tecla la despierta', (await ev(`!${rest}`)) === true)
    check('12 y lo que se tecleó no llegó a la página: buscador vacío, carrito vacío', (await ev("document.querySelector('#venta-search-input').value === '' && document.body.innerText.includes('Carrito vacío')")) === true, await ev("document.querySelector('#venta-search-input').value"))
    check('12 el cursor sigue en el buscador', (await ev("document.activeElement === document.querySelector('#venta-search-input')")) === true)
    await typeKey('B', 'KeyB', 66)
    await sleep(300)
    check('12 pasado el instante, el teclado vuelve a escribir normal', (await ev("document.querySelector('#venta-search-input').value")) === 'B')
    await ev(setInput('#venta-search-input', ''))
    // A tap wakes it without pressing what is behind (here, the row of a product, which would add it to the cart).
    const at = await ev("(() => { const r = [...document.querySelectorAll('[role=row]')].find((x) => x.innerText.includes('Balde')).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()")
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y })
    await sleep(300)
    await skipAhead()
    await waitFor(`!!${rest}`, 9000)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 })
    await sleep(700)
    check('12 un toque la despierta y no pulsa lo de atrás (el carrito sigue vacío)', (await ev(`!${rest}`)) === true && (await ev("document.body.innerText.includes('Carrito vacío')")) === true)
    // Someone in the middle of a form: it doesn't come up.
    await ev(`(${bell}).click()`)
    await waitFor("!!document.querySelector('dialog[open]')", 5000)
    await skipAhead()
    await sleep(7000)
    check('12 con una ventana abierta no aparece', (await ev(`!${rest}`)) === true)
    await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
    await ev('Date.now = window.__realNow')
    await sleep(300)
    if (reminderDue) {
      // "Ya pagué" (confirmed) hides it on this device until next month's.
      await ev(`(${bell}).click()`)
      await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Pago mensual del sistema')", 5000)
      await ev(clickText('Ya pagué', "document.querySelector('dialog[open]')"))
      await waitFor("[...document.querySelectorAll('dialog[open]')].some((d) => d.innerText.includes('¿Ya hiciste el pago de este mes?'))", 5000)
      await ev(clickText('Sí, ya pagué', "[...document.querySelectorAll('dialog[open]')].find((d) => d.innerText.includes('¿Ya hiciste el pago'))"))
      await waitFor("document.querySelectorAll('dialog[open]').length === 1", 5000)
      await sleep(800) // the save to the server
      await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
      // The setting comes back the way every change does (Realtime, which the stand-in doesn't play: a reload pulls it).
      await send('Page.reload')
      await waitFor("!!document.querySelector('#venta-search-input')", 30000)
      await sleep(1500)
      await ev(`(${bell}).click()`)
      await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Pendientes de hoy')", 5000)
      check('12 "Ya pagué" (confirmado) lo quita de la lista y de la campana hasta el mes que viene (queda guardado en el servidor)', !(await dialogText()).includes('Pago mensual del sistema') && (await ev(`(${bell})?.innerText.trim()`)) === '3', await dialogText())
      await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
      await sleep(300)
    }

    // 13. The Administrador's phone notifications: the app's service worker shows what the Function sends through
    // Firebase (data: title, body, link — functions/index.js), and opening one lands on "Pendientes de hoy".
    const origin = new URL(appUrl).origin
    await ev(`(${bell}).click()`)
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Pendientes de hoy')", 5000)
    check('13 el Administrador ve cómo recibir estos avisos en el celular, a sus horas', (await dialogText()).includes('Recibe estos pendientes en este equipo aunque la app esté cerrada: 7:00 a. m., 12:20 p. m., 5:00 p. m., 6:00 p. m. y 8:00 p. m.'), await dialogText())
    await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
    await send('Browser.grantPermissions', { origin, permissions: ['notifications'] })
    await send('ServiceWorker.enable')
    let registrationId
    for (let i = 0; i < 40 && !registrationId; i++) {
      registrationId = c.swEvents.flatMap((e) => e.params?.registrations ?? []).find((r) => r.scopeURL.startsWith(origin) && !r.isDeleted)?.registrationId
      if (!registrationId) await sleep(250)
    }
    const fcmData = { data: { title: 'Pendientes: 3 asuntos por atender', body: 'Productos agotados: 1 producto sin unidades', link: '/?avisos=1' }, from: '358472149721', fcmMessageId: 'prueba' }
    await send('ServiceWorker.deliverPushMessage', { origin, registrationId: String(registrationId), data: JSON.stringify(fcmData) })
    const shown = await waitFor("navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((ns) => ns.map((x) => x.title + ' | ' + x.body + ' | ' + x.data?.link).join('\\n'))", 8000)
    check('13 un aviso que llega por Firebase se muestra como notificación del sistema, con su texto', shown.ok && shown.value.includes('Pendientes: 3 asuntos por atender | Productos agotados: 1 producto sin unidades | /?avisos=1'), { registrationId, shown })
    await send('Page.navigate', { url: origin + '/?avisos=1' })
    check('13 tocarlo abre la app en "Pendientes de hoy"', (await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Pendientes de hoy') && location.search === ''", 30000)).ok, await ev('location.href'))
    await ev(clickText('Entendido', "document.querySelector('dialog[open]')"))
    await sleep(300)

    // 14. Proveedores → Nuevo pedido: each line can set the product's new selling price; the order being put together
    // survives going to another module and back; "Ya llegó" receives it at once (stock, cost and price) — and the sales
    // already made don't change.
    const salesBefore14 = JSON.stringify((await control('/__test/state')).sales)
    await ev(goto('Proveedores'))
    await waitFor("[...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.startsWith('Nuevo pedido'))", 10000)
    await ev("[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Nuevo pedido')).click()")
    await waitFor("!!document.querySelector('#order-supplier')", 8000)
    await ev(`(() => { const s = document.querySelector('#order-supplier'); const o = [...s.options].find((x) => x.text === 'Plásticos del Valle'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await waitFor("[...document.querySelectorAll('[role=row]')].some((r) => r.innerText.includes('Vaso'))", 8000)
    await ev("[...document.querySelectorAll('[role=row]')].find((r) => r.innerText.includes('Vaso')).click()")
    await waitFor("!!document.querySelector('input[aria-label=\"Precio de venta de Vaso\"]')", 5000)
    check('14 el pedido tiene la casilla del precio de venta, con el precio de hoy', (await ev("document.querySelector('input[aria-label=\"Precio de venta de Vaso\"]').value")) === '1000')
    await ev(setInput('input[aria-label="Cantidad de Vaso"]', '10'))
    await ev(setInput('input[aria-label="Costo unitario de Vaso"]', '600'))
    await ev(setInput('input[aria-label="Precio de venta de Vaso"]', '1200'))
    await sleep(300)
    const panel14 = await ev('document.body.innerText')
    check('14 dice el margen con el costo y el precio nuevos, y que el precio cambia al recibir', panel14.includes('Venta hoy $1.000,00 · margen 100.0%') && panel14.includes('1 precio de venta cambia al recibir'), panel14.slice(panel14.indexOf('Pedido nuevo'), panel14.indexOf('Pedido nuevo') + 500))
    await ev(goto('Venta'))
    await waitFor("!!document.querySelector('#venta-search-input')", 8000)
    await ev(goto('Proveedores'))
    await waitFor("!!document.querySelector('#order-supplier')", 8000)
    const back14 = {
      supplier: await ev("document.querySelector('#order-supplier').selectedOptions[0]?.text"),
      qty: await ev("document.querySelector('input[aria-label=\"Cantidad de Vaso\"]')?.value"),
      cost: await ev("document.querySelector('input[aria-label=\"Costo unitario de Vaso\"]')?.value"),
      price: await ev("document.querySelector('input[aria-label=\"Precio de venta de Vaso\"]')?.value"),
    }
    check('14 al ir a Venta y volver, el pedido sigue ahí (proveedor, producto, cantidad, costo y precio)', back14.supplier === 'Plásticos del Valle' && back14.qty === '10' && back14.cost === '600' && back14.price === '1200', back14)
    await shot(c, '20-nuevo-pedido-precio-venta')
    await ev(clickText('Ya llegó'))
    const sheet14 = await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Recibir pedido')", 15000)
    check('14 "Ya llegó" registra el pedido y abre su recepción con el precio nuevo', sheet14.ok && (await ev("document.querySelector('dialog[open] input[aria-label=\"Precio de venta de Vaso\"]')?.value")) === '1200', await dialogText())
    // 14b. The invoice date and the due date are editable: it arrived today but was invoiced four days ago, and the days of
    // credit count from the invoice.
    const dayAt = (offset) => ev(`(()=>{const [y,m,d]=${TODAY_IN_PAGE}.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+(${offset}))).toISOString().slice(0,10)})()`)
    const field14 = (id) => ev(`document.querySelector('dialog[open] #${id}')?.value`)
    const niceDay = (key) => ev(`new Date('${key}T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })`)
    check('14b la recepción a crédito trae la fecha de la factura (hoy) y el vencimiento a 30 días', (await field14('receive-invoice-date')) === (await dayAt(0)) && (await field14('receive-due-date')) === (await dayAt(30)), await dialogText())
    const invoiced14 = await dayAt(-4)
    await ev(setInput('dialog[open] #receive-invoice-date', invoiced14))
    await sleep(300)
    check('14b al poner la factura de hace cuatro días, el vencimiento se corre con ella (26 días desde hoy)', (await field14('receive-due-date')) === (await dayAt(26)), await dialogText())
    await ev(setInput('dialog[open] #receive-due-date', await dayAt(10)))
    await sleep(300)
    check('14b el vencimiento también se puede poner a mano, y dice los días que hay entre la factura y él', (await dialogText()).includes('14 días después de la factura') && (await field14('receive-due-date')) === (await dayAt(10)), await dialogText())
    await ev(setInput('dialog[open] #receive-invoice-date', await dayAt(1)))
    await sleep(300)
    check('14b una factura de fecha futura se avisa y no deja recibir', (await dialogText()).includes('no puede ser futura') && (await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim().startsWith('Recibir y registrar'))?.disabled")) === true)
    await ev(setInput('dialog[open] #receive-invoice-date', invoiced14))
    await sleep(300)
    await shot(c, '21-recibir-con-precio')
    await ev(clickText('Recibir y registrar', "document.querySelector('dialog[open]')"))
    await waitFor("!document.querySelector('dialog[open]')", 15000)
    check('14 recibido, el pedido nuevo queda vacío y se vuelve a Pedidos', (await ev("!document.querySelector('input[aria-label=\"Precio de venta de Vaso\"]') && [...document.querySelectorAll('[role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.startsWith('Pedidos')")) === true)
    const st14 = await control('/__test/state')
    check('14 al recibir, el stock sube de una vez (Vaso: 0 → 10)', st14.stocks.N2 === 10, st14.stocks)
    check('14 y las ventas ya hechas no cambian', JSON.stringify(st14.sales) === salesBefore14)
    await send('Page.reload')
    await waitFor("!!document.querySelector('#venta-search-input') || !!document.querySelector('[role=tablist]')", 30000)
    const vaso = await waitFor(`(${idb('products')}).then((ps) => { const p = ps.find((x) => x.code === 'N2'); return p && p.price === 1200 && p.stock === 10 ? p : null })`, 20000)
    check('14 el producto queda con su precio de venta nuevo ($1.200)', vaso.ok, vaso)
    // 14b (cont.). After the reload (the stand-in plays no Realtime): the account payable is due on the day that was typed, and the
    // order says when it was invoiced.
    await ev("[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Por pagar')).click()")
    const payable14 = await waitFor("[...document.querySelectorAll('[role=row]')].some((r) => r.innerText.includes('Plásticos del Valle') && r.innerText.includes('6.000,00'))", 10000)
    const payableRow14 = await ev("[...document.querySelectorAll('[role=row]')].find((r) => r.innerText.includes('Plásticos del Valle') && r.innerText.includes('6.000,00'))?.innerText||''")
    check('14b la cuenta por pagar vence el día que se puso (en 10 días)', payable14.ok && payableRow14.includes(await niceDay(await dayAt(10))) && payableRow14.includes('Vence en 10 días'), payableRow14)
    await ev("[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith('Pedidos')).click()")
    // The list opens on "Por recibir": the order that was just received is under "Recibidos".
    await waitFor("!!document.querySelector('select[aria-label=\"Filtrar por estado\"]')", 8000)
    await ev(`(() => { const s = document.querySelector('select[aria-label="Filtrar por estado"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'recibido'); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
    await waitFor("[...document.querySelectorAll('[role=row]')].some((r) => r.innerText.includes('Plásticos del Valle') && r.innerText.includes('6.000,00'))", 10000)
    await ev("[...document.querySelectorAll('[role=row]')].find((r) => r.innerText.includes('Plásticos del Valle') && r.innerText.includes('6.000,00')).click()")
    const detail14 = await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Facturado el')", 8000)
    check('14b y el pedido dice que se facturó ese día', detail14.ok && (await dialogText()).includes(await niceDay(invoiced14)), await dialogText())
    await ev(clickText('Cerrar', "document.querySelector('dialog[open]')"))
    await sleep(300)

    // 15. Stock: the quick − / + of the table ask how many and why, and the Auditoría shows every change with who did it.
    await ev(goto('Stock'))
    await waitFor("[...document.querySelectorAll('[role=row]')].some((r) => r.innerText.includes('Cuerda'))", 15000)
    const c3Before = (await control('/__test/state')).stocks.C3
    await ev("[...document.querySelectorAll('[role=row]')].find((r) => r.innerText.includes('Cuerda')).querySelector('button[title=\"Sumar 1\"]').click()")
    const adj = await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Sumar al stock')", 8000)
    check('15 el + de la tabla abre una ventanita que pregunta cuánto y por qué (sin motivo no deja guardar)', adj.ok && (await ev("document.querySelector('dialog[open] button[data-enter]').disabled")) === true, await dialogText())
    await ev(setInput('dialog[open] input[aria-label="Cantidad"]', '3'))
    await ev(clickText('Devolución de un cliente', "document.querySelector('dialog[open]')"))
    await sleep(300)
    await shot(c, '22-ajuste-con-motivo')
    await ev("document.querySelector('dialog[open] button[data-enter]').click()")
    await waitFor("!document.querySelector('dialog[open]')", 8000)
    check('15 con el motivo, el stock cambia (+3)', (await control('/__test/state')).stocks.C3 === c3Before + 3, (await control('/__test/state')).stocks)
    await send('Page.reload') // the stand-in plays no Realtime: the new audit lines come with a download
    await waitFor("[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Auditoría'))", 30000)
    await waitFor(`(${idb('auditLog')}).then((rows) => rows.some((r) => r.reason === 'Devolución de un cliente'))`, 20000)
    await ev(clickText('Auditoría'))
    await waitFor("(document.querySelector('dialog[open]')?.innerText||'').includes('Devolución de un cliente')", 8000)
    const audit15 = await dialogText()
    check('15 la Auditoría muestra el ajuste: producto, +3, antes → después, el motivo y quién lo hizo', /Cuerda[\s\S]*?\+3[\s\S]*?Ajuste \(suma\)[\s\S]*?Devolución de un cliente[\s\S]*?Propietario/.test(audit15), audit15.slice(0, 700))
    check('15 y también lo que entró al recibir el pedido del paso 14', /Vaso[\s\S]*?Entrada de mercancía[\s\S]*?Pedido #P\d{4} recibido · Plásticos del Valle[\s\S]*?Propietario/.test(audit15), audit15.slice(0, 1200))
    await shot(c, '23-auditoria')
    await ev(setInput('dialog[open] input[type="search"], dialog[open] input[placeholder^="Buscar producto, código, usuario"]', 'devolución'))
    await sleep(400)
    const filtered15 = await dialogText()
    check('15 se puede buscar por motivo', filtered15.includes('Devolución de un cliente') && !filtered15.includes('Plásticos del Valle'), filtered15.slice(0, 600))
    await ev(`document.querySelector('dialog[open] button[aria-label="Cerrar"]').click()`)
    await sleep(300)

    const errors = c.logs.filter((l) => /EXC/.test(l))
    check('sin errores de JavaScript en toda la prueba', errors.length === 0, errors.slice(0, 5))
  } finally {
    c.close()
  }
}

/** The installed-app variant, served from a sub-folder of a plain file server (like files on a device). */
async function packagedFlow(outDir) {
  const PREFIX = '/some/folder/app/'
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' }
  const seen = []
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    seen.push(url)
    const file = url.startsWith(PREFIX) ? path.join(outDir, url.slice(PREFIX.length) || 'index.html') : ''
    if (!file || !file.startsWith(outDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404
      return void res.end('not found')
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  const port = PORTS.preview + 10
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  await control('/__test/reset', {})
  await control('/__test/supa', { down: false })
  const c = await launchChrome()
  const { ev, send, waitFor } = c
  try {
    const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
    check('P el index.html usa direcciones relativas', /src="\.\/assets\//.test(index) && !/src="\/assets\//.test(index), index.slice(0, 500))
    check('P no hay service worker en la versión instalada', !fs.existsSync(path.join(outDir, 'sw.js')) && !/registerSW/.test(index))
    await send('Page.navigate', { url: `http://127.0.0.1:${port}${PREFIX}index.html` })
    check('P arranca desde una carpeta (no desde la raíz) y muestra el ingreso', (await waitFor("!!document.querySelector('#login-email')", 30000)).ok, c.logs)
    check('P no pidió nada fuera de su carpeta', seen.every((u) => u.startsWith(PREFIX)), seen.filter((u) => !u.startsWith(PREFIX)))
    check('P las tipografías cargan desde su propia carpeta', (await waitFor("[...document.fonts].some(f => f.family.includes('IBM Plex Sans') && f.status === 'loaded')", 10000)).ok && seen.some((u) => /\.woff2$/.test(u)), seen.filter((u) => /woff/.test(u)))
    // A device that has never signed in and has no internet: the app opens (its files are on the device), and the login
    // says why it can't go on instead of an English error.
    await control('/__test/supa', { down: true })
    await ev(setInput('#login-email', 'dueno@x.com'))
    await ev(setInput('#login-password', 'clave123'))
    await ev(clickText('Ingresar'))
    check('P sin internet, ingresar explica (en español) que hace falta internet', (await waitFor("document.body.innerText.includes('para iniciar sesión hace falta internet')", 30000)).ok, await ev('document.body.innerText'))
    await control('/__test/supa', { down: false })
    await ev(clickText('Ingresar'))
    check('P inicia sesión contra el servidor de API y de cuentas fijados al construir', (await waitFor("!!document.querySelector('#venta-search-input')", 30000)).ok, c.logs)
    check('P los productos llegan (llamadas entre orígenes con CORS)', (await waitFor("document.body.innerText.includes('Balde')", 30000)).ok)
    // The connection monitor probes /api/health from another origin too, with no preflight that the API would refuse: if
    // that probe failed the till would think it had no internet while selling.
    await sleep(3500)
    check('P la sonda de conexión también funciona entre orígenes (no aparece "Sin conexión")', (await ev(pillIs('/Sin conexión|Enviando|rechazada/'))) === false)
    const probe = await ev(`fetch('${apiUrl()}/api/health', { cache: 'no-store' }).then(r => r.json()).then(j => j.ok === true).catch(() => false)`)
    check('P y /api/health contesta a esa petición desde la carpeta de la app', probe === true)
    await ev(goto('Facturas'))
    check('P navegar usa la parte # de la dirección', (await waitFor("location.hash === '#/facturas'", 8000)).ok, await ev('location.href'))
    await send('Page.reload')
    check('P recargar en esa página la vuelve a abrir (sin servidor que reescriba rutas)', (await waitFor("location.hash === '#/facturas' && document.body.innerText.includes('Facturas')", 30000)).ok, await ev('location.href'))
    check('P sin errores de JavaScript', c.logs.length === 0, c.logs)
  } finally {
    c.close()
    server.close()
  }
}

let failed = true
try {
  await startApi()
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-offline-app-'))
  console.log('Compilando la aplicación contra los servidores de prueba…')
  buildApp(path.join(work, 'web'))
  buildApp(path.join(work, 'packaged'), { packaged: true })
  await startPreview(path.join(work, 'web'))
  await mainFlow(`http://localhost:${PORTS.preview}/`, path.join(work, 'web'))
  await packagedFlow(path.join(work, 'packaged'))
  failed = results.some((r) => !r)
  console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones correctas`)
} catch (err) {
  console.error(err instanceof Error ? err.stack : err)
} finally {
  stopAll()
}
process.exit(failed ? 1 : 0)
