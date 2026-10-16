// npm run check:exe — after `npm run build:exe`. The REAL Electron runtime and the REAL desktop/main.cjs, inside an
// app.asar like the shipped one, but with the web build pointed at the test servers of scripts/offline-check (the API on
// an in-memory database and a Supabase stand-in — never production): sign in, sell, the receipt's WhatsApp button
// (which must reach the PC's browser, not a window of the app), reload, sell without internet and get it back, one
// instance at a time, a request for a file outside the app, and the program ending when its window closes.
// Opens a real window for a few seconds. ~40 s.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp, control, startApi, stopAll } from '../scripts/offline-check/servers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const pack = path.resolve(process.argv[2] ?? path.join(here, 'build/pack/Plastimax-win32-x64'))
const PAGE_PORT = 9335
const MAIN_PORT = 9336
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (label, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ok  ' : '  FALLÓ') + ' ' + label + (cond ? '' : ' ' + JSON.stringify(detail)))
}

/** Drives a Chromium/Node inspector target over the DevTools protocol (the page of the window, or the main process). */
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let id = 0
  const pending = new Map()
  const logs = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) pending.get(d.id)(d)
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text))
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id
      pending.set(i, res)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error('en la página: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text))
    return r.result?.result?.value
  }
  const waitFor = async (expression, ms) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try {
        const value = await ev(expression)
        if (value) return { ok: true, ms: Date.now() - t0, value }
      } catch {
        // navigating
      }
      await sleep(250)
    }
    return { ok: false, ms: Date.now() - t0 }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  return { send, ev, waitFor, logs, close: () => ws.close() }
}
const targets = async (port) => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const pageCount = async () => (await targets(PAGE_PORT)).filter((t) => t.type === 'page').length

const setInput = (sel, v) =>
  `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`
const clickText = (text, scope = 'document') =>
  `(()=>{const b=[...${scope}.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})&&!x.disabled);if(!b)return false;b.click();return true})()`

/** Types a code in Venta's search box, charges the cart in cash and returns what the receipt says. */
async function sellByCode(c, code) {
  const { ev, send, waitFor } = c
  await ev(setInput('#venta-search-input', code))
  await ev("document.querySelector('#venta-search-input').focus()")
  await sleep(300)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  if (!(await waitFor("document.body.innerText.includes('Carrito') && !document.body.innerText.includes('Carrito vacío')", 8000)).ok) return { ok: false, step: 'carrito' }
  await ev(clickText('Cobrar'))
  if (!(await waitFor("!!document.querySelector('dialog[open]') && !!document.querySelector('dialog[open] button[data-enter]')", 8000)).ok) return { ok: false, step: 'hoja de cobro' }
  await ev(clickText('Exacto', "document.querySelector('dialog[open]')"))
  await ev(clickText('Confirmar cobro', "document.querySelector('dialog[open]')"))
  const w = await waitFor("document.body.innerText.includes('RECIBO PROVISIONAL') || document.body.innerText.includes('RECIBO DE VENTA')", 15000)
  const text = await ev('document.body.innerText')
  return { ok: w.ok, provisional: text.includes('RECIBO PROVISIONAL'), text }
}

// The shell this runs from may itself be Electron (VS Code, Claude Code) and leave ELECTRON_RUN_AS_NODE set, which makes
// Plastimax.exe behave as plain Node ("bad option: --user-data-dir").
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'plastimax-exe-check-'))
let app
let exited = null
let failed = true
try {
  if (!fs.existsSync(path.join(pack, 'Plastimax.exe'))) throw new Error(`No hay ${pack}\\Plastimax.exe: corre antes npm run build:exe`)
  await startApi()
  console.log('Compilando la app (versión instalada) contra los servidores de prueba…')
  buildApp(path.join(work, 'web'), { packaged: true })

  // The shipped runtime with the test build inside an app.asar, like the real one.
  const exeDir = path.join(work, 'exe')
  fs.cpSync(pack, exeDir, { recursive: true })
  const appDir = path.join(work, 'app')
  fs.mkdirSync(appDir)
  fs.cpSync(path.join(work, 'web'), path.join(appDir, 'web'), { recursive: true })
  fs.copyFileSync(path.join(here, 'main.cjs'), path.join(appDir, 'main.cjs'))
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'plastimax-fr', productName: 'Plastimax F.R.', version: '0.0.0', main: 'main.cjs' }))
  execFileSync(process.execPath, [path.join(here, 'node_modules/@electron/asar/bin/asar.mjs'), 'pack', appDir, path.join(exeDir, 'resources/app.asar')])

  await control('/__test/reset', {})
  await control('/__test/supa', { down: false, accessTtl: 3600 })
  const exe = path.join(exeDir, 'Plastimax.exe')
  const profile = path.join(work, 'perfil')
  app = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PAGE_PORT}`, `--inspect=${MAIN_PORT}`], { stdio: 'ignore', env })
  app.on('exit', (code) => (exited = code))
  let target
  for (let i = 0; i < 120 && !target; i++) {
    try {
      target = (await targets(PAGE_PORT)).find((t) => t.type === 'page' && t.url.startsWith('app://plastimax/'))
    } catch {
      // still starting
    }
    if (!target) await sleep(250)
  }
  if (!target) throw new Error('la app no abrió su ventana')
  const c = await attach(target.webSocketDebuggerUrl)
  const { ev, send, waitFor } = c
  const main = await attach((await targets(MAIN_PORT))[0].webSocketDebuggerUrl)
  // What the program hands to the PC's browser is recorded instead of opened.
  await main.ev("(() => { const { shell } = process.mainModule.require('electron'); globalThis.__opened = []; shell.openExternal = (u) => { globalThis.__opened.push(u); return Promise.resolve() } })()")
  const opened = async () => JSON.parse(await main.ev('JSON.stringify(globalThis.__opened)'))

  check('0 abre con su propio esquema (app://), no desde file://', (await ev('location.origin')) === 'app://plastimax', await ev('location.href'))
  check('0 la ventana se llama Plastimax F.R. aunque la página diga otro título', (await main.ev("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getTitle()")) === 'Plastimax F.R.')
  check('0 la página no tiene Node (ventana aislada)', (await ev("typeof require === 'undefined' && typeof process === 'undefined'")) === true)
  check('0 un archivo de fuera de la app no se sirve (403)', (await ev("fetch('app://plastimax/..%2f..%2fpackage.json').then(r => r.status)")) === 403)

  // 1. Sign in.
  check('1 aparece el ingreso', (await waitFor("!!document.querySelector('#login-email')", 30000)).ok, c.logs)
  const today = await ev("new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())")
  await ev(`localStorage.setItem('mtp-daily-notices', JSON.stringify({ owner: ${JSON.stringify(today)} }))`)
  await ev(setInput('#login-email', 'dueno@x.com'))
  await ev(setInput('#login-password', 'clave123'))
  await ev(clickText('Ingresar'))
  check('1 entra a Venta con su cuenta', (await waitFor("!!document.querySelector('#venta-search-input')", 30000)).ok, c.logs)
  check('1 los productos se descargan al equipo (API y Supabase desde app://)', (await waitFor("document.body.innerText.includes('Balde')", 30000)).ok, (await ev('document.body.innerText')).slice(0, 200))
  check('1 sin indicador de "Sin conexión"', (await ev("![...document.querySelectorAll('button')].some(b=>/Sin conexión|Enviando|rechazada/.test(b.getAttribute('aria-label')||''))")) === true)

  // 2. Sell with internet.
  const sale = await sellByCode(c, 'A1')
  check('2 se cobra con internet: recibo de venta definitivo', sale.ok && !sale.provisional && /RECIBO DE VENTA #\d{4}/.test(sale.text), sale.text?.slice(0, 160))
  const st = await control('/__test/state')
  check('2 el servidor tiene la venta y el stock bajó a 49', st.sales.length === 1 && st.stocks.A1 === 49, { ventas: st.sales.length, stock: st.stocks })

  // 3. The receipt's WhatsApp button: window.open('') inside the click, its address set afterwards.
  check('3 la hoja del recibo ofrece WhatsApp', (await waitFor("[...document.querySelectorAll('dialog[open] button')].some(b=>b.textContent.includes('WhatsApp'))", 8000)).ok)
  await ev(clickText('WhatsApp', "document.querySelector('dialog[open]')"))
  check('3 pide el celular', (await waitFor("!!document.querySelector('#receipt-destination')", 8000)).ok)
  await ev(setInput('#receipt-destination', '3001234567'))
  const windowsBefore = await pageCount()
  await ev(clickText('Enviar', "document.querySelector('dialog[open]')"))
  let wa = []
  for (let i = 0; i < 40 && !wa.length; i++) {
    wa = await opened()
    if (!wa.length) await sleep(250)
  }
  check('3 la dirección de WhatsApp (con el número y el recibo) va al navegador del PC', wa.length === 1 && /^https:\/\/wa\.me\/573001234567\?text=/.test(wa[0]), wa)
  await sleep(800)
  check('3 y no queda ninguna ventana auxiliar abierta', (await pageCount()) === windowsBefore, { antes: windowsBefore, ahora: await pageCount() })
  await ev("document.body.insertAdjacentHTML('beforeend', '<a id=ext href=\"https://example.com/algo\" target=_blank>x</a>')")
  await ev("document.getElementById('ext').click()")
  await sleep(500)
  check('3 un enlace con target=_blank también va al navegador, no a una ventana nueva', (await opened()).includes('https://example.com/algo') && (await pageCount()) === windowsBefore)
  await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Cerrar')?.click()")
  await sleep(400)

  // 4. Reload (Ctrl+R): still signed in, the local copy has the stock.
  await send('Page.reload')
  check('4 tras recargar sigue dentro (la sesión quedó en el perfil de la app)', (await waitFor("!!document.querySelector('#venta-search-input')", 30000)).ok, c.logs)
  check('4 y la copia local conserva el stock nuevo (49)', (await waitFor("(()=>{const row=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='A1');return !!row&&document.body.innerText.includes('49')})()", 20000)).ok)

  // 5. Without internet: the sale is kept on the PC and goes up once when it is back.
  await control('/__test/mode', { kind: 'down' })
  await control('/__test/supa', { down: true })
  const off = await sellByCode(c, 'A1')
  check('5 sin internet se vende igual: recibo provisional', off.ok && off.provisional, off.text?.slice(0, 160))
  await ev("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='Cerrar')?.click()")
  await control('/__test/mode', {})
  await control('/__test/supa', { down: false })
  let st2
  for (let i = 0; i < 120; i++) {
    st2 = await control('/__test/state')
    if (st2.sales.length === 2) break
    await sleep(1000)
  }
  check('5 al volver el internet la venta sube sola, una vez, y el stock queda en 48', st2.sales.length === 2 && st2.stocks.A1 === 48, { ventas: st2.sales.length, stock: st2.stocks })

  // 6. Navigation (hash router) in the real window.
  await ev(`[...document.querySelectorAll('a')].find(x=>x.textContent.trim().startsWith('Facturas'))?.click()`)
  check('6 navegar usa la parte # de la dirección', (await waitFor("location.hash === '#/facturas'", 8000)).ok, await ev('location.href'))
  check('sin errores de JavaScript en la página', c.logs.length === 0, c.logs)

  // 7. Opening it again brings the first window forward instead of starting a second program.
  const second = spawn(exe, [`--user-data-dir=${profile}`], { stdio: 'ignore', env })
  const secondEnd = await new Promise((res) => {
    const t = setTimeout(() => res('sigue vivo'), 15000)
    second.on('exit', (code) => {
      clearTimeout(t)
      res(code)
    })
  })
  if (secondEnd === 'sigue vivo') second.kill()
  check('7 abrirla otra vez no abre una segunda: la segunda se cierra sola y la primera sigue', secondEnd !== 'sigue vivo' && exited === null, { segunda: secondEnd, primera: exited })

  // 8. Closing the window ends the program.
  c.close()
  main.close()
  const browser = await attach((await (await fetch(`http://127.0.0.1:${PAGE_PORT}/json/version`)).json()).webSocketDebuggerUrl)
  void browser.send('Browser.close') // (no answer ever comes: the browser is gone)
  for (let i = 0; i < 60 && exited === null; i++) await sleep(250)
  check('8 al cerrar la ventana el programa termina', exited !== null, exited)
  failed = results.some((r) => !r)
} catch (e) {
  console.error(e instanceof Error ? e.stack : e)
} finally {
  try {
    if (exited === null) app?.kill()
  } catch {
    // already gone
  }
  stopAll()
  await sleep(800)
  fs.rmSync(work, { recursive: true, force: true })
}
console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones correctas`)
process.exit(failed ? 1 : 0)
