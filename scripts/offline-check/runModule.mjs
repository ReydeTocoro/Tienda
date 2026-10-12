// npm run check:offline-browser
// The client side of selling without internet, in real headless Chrome, against the real API on an in-memory database
// whose connection is cut on purpose. Needs Google Chrome. Two phases:
//  1. one page runs the logic end to end: the outbox and the stock overlay, sending with retries, a lost answer that
//     must not duplicate a sale, timeouts, which answers mean "the server is down", the connection monitor and the
//     charging flow (module/main.tsx);
//  2. what needs a browser profile of its own or a second tab (tabs/main.tsx): the local database of a device that
//     already works being upgraded without losing anything, two tabs sending the same queue at the same moment, and a
//     queue of 200 sales.
import { launchChrome, sleep } from './cdp.mjs'
import { PORTS, control, startApi, startViteDev, stopAll } from './servers.mjs'

let total = 0
let bad = 0
const check = (label, cond, detail) => {
  total++
  if (!cond) bad++
  console.log((cond ? '  ok  ' : '  FALLÓ') + ' ' + label + (cond ? '' : '\n        ' + JSON.stringify(detail)))
}
const page = (name) => `http://localhost:${PORTS.vite}/scripts/offline-check/${name}/index.html`

/** Phase 1: the page checks itself and leaves its verdict as JSON in #out. */
async function moduleChecks() {
  await control('/__test/reset', {})
  const chrome = await launchChrome()
  try {
    await chrome.send('Page.navigate', { url: page('module') })
    let out = ''
    const started = Date.now()
    while (Date.now() - started < 240_000) {
      await sleep(500)
      out = (await chrome.ev(`document.getElementById('out') && document.getElementById('out').textContent`).catch(() => '')) ?? ''
      if (out.startsWith('{')) break
    }
    if (!out.startsWith('{')) throw new Error('La página no terminó a tiempo: ' + (out || '(sin salida)') + '\n' + chrome.logs.join('\n'))
    const result = JSON.parse(out)
    for (const label of result.passed) check(label, true)
    for (const f of result.failures) check(f.label, false, f.detail)
  } finally {
    chrome.close()
  }
}

/** Phase 2: steps driven from here, tab by tab. */
async function tabChecks() {
  await control('/__test/reset', {})
  const chrome = await launchChrome()
  try {
    const ready = (tab) => tab.waitFor(`document.title === 'listo'`, 60_000)
    await chrome.send('Page.navigate', { url: page('tabs') })
    check('la página de las pruebas con pestañas carga', (await ready(chrome)).ok, chrome.logs)

    // A device that already works has the database of an older version of the app, with its data.
    const up = await chrome.ev('window.__check.upgradeFromV6()')
    check(
      'la base local de un equipo que ya trabaja (versión anterior, con datos) se actualiza sin perder nada y gana la cola',
      up.oldVersion === 6 && up.newVersion >= 7 && up.tables.includes('outbox') && up.tables.includes('products') && up.products === 3 && up.sales === 1 && up.storeName === 'Tienda vieja' && up.outbox === 0,
      up,
    )

    await chrome.ev('window.__check.seed()')
    const queued = await chrome.ev('window.__check.enqueue(40)')
    check('quedan 40 ventas en la cola del equipo', queued.pending === 40, queued)
    const tab2 = await chrome.newTab(page('tabs'))
    check('la segunda pestaña (mismo navegador, misma base) carga', (await ready(tab2)).ok)

    // Both tabs send the same queue at the same moment, the server taking its time so the sending overlaps.
    await control('/__test/mode', { kind: 'delay', ms: 120, path: '/api/sales/offline' })
    const [a, b] = await Promise.all([chrome.ev('window.__check.send(true)'), tab2.ev('window.__check.send(true)')])
    await control('/__test/mode', { kind: 'ok' })
    let st = await control('/__test/state')
    check(
      'dos pestañas enviando la misma cola a la vez: cada venta sale UNA sola vez (el candado entre pestañas)',
      st.requests['POST /api/sales/offline'] === 40 && st.sales.length === 40 && a.sent + b.sent === 40,
      { requests: st.requests, sales: st.sales.length, a, b },
    )
    check('y las dos pestañas ven la cola vacía', (await chrome.ev('window.__check.counts()')).pending === 0 && (await tab2.ev('window.__check.counts()')).pending === 0)
    check(
      'el stock del servidor y el de las dos pestañas coinciden (20 − 40 × 0,05 = 18)',
      st.stocks.C3 === 18 && (await chrome.ev(`window.__check.stock('C3')`)) === 18 && (await tab2.ev(`window.__check.stock('C3')`)) === 18,
      st.stocks,
    )

    // Not waiting for the other tab: one sends, the other leaves it to the first.
    await chrome.ev('window.__check.enqueue(10)')
    await control('/__test/mode', { kind: 'delay', ms: 120, path: '/api/sales/offline' })
    const [c, d] = await Promise.all([chrome.ev('window.__check.send(false)'), tab2.ev('window.__check.send(false)')])
    await control('/__test/mode', { kind: 'ok' })
    st = await control('/__test/state')
    check(
      'sin esperar a la otra pestaña: una envía y la otra se aparta ("ocupado"), sin repetir nada',
      st.requests['POST /api/sales/offline'] === 50 && c.sent + d.sent === 10 && [c, d].filter((r) => r.stoppedBy === 'busy').length === 1,
      { requests: st.requests, c, d },
    )

    // A big queue goes up complete, one by one, in the order the sales were made.
    await chrome.ev('window.__check.enqueue(200)')
    const t0 = Date.now()
    const big = await chrome.ev('window.__check.send(true)')
    const seconds = (Date.now() - t0) / 1000
    st = await control('/__test/state')
    check(`una cola grande (200 ventas) se envía completa en ${seconds.toFixed(0)} s`, big.sent === 200 && big.left === 0 && st.requests['POST /api/sales/offline'] === 250 && st.sales.length === 250, { big, requests: st.requests, sales: st.sales.length })
    const numbers = st.sales.map((s) => Number(String(s.refLocal).slice(5)))
    check('y llegan en el orden en que se hicieron', numbers.every((n, i) => i === 0 || n > numbers[i - 1]), numbers.slice(0, 12))
    check('el stock cuadra con todas (20 − 250 × 0,05 = 7,5), en el servidor y en el equipo', st.stocks.C3 === 7.5 && (await chrome.ev(`window.__check.stock('C3')`)) === 7.5, st.stocks)
    check('ninguna venta quedó marcada para revisar sin motivo (todas con stock suficiente)', st.sales.every((s) => !s.reviewNotes), st.sales.find((s) => s.reviewNotes)?.reviewNotes)
    check('sin errores de JavaScript en ninguna pestaña', chrome.logs.length === 0, chrome.logs)
  } finally {
    chrome.close()
  }
}

try {
  await startApi()
  await startViteDev()
  await moduleChecks()
  await tabChecks()
  console.log(`\n${total - bad}/${total} comprobaciones correctas`)
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  bad++
} finally {
  stopAll()
}
process.exit(bad ? 1 : 0)
