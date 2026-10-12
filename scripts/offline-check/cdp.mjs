// A minimal driver for headless Chrome over the DevTools protocol (no dependencies): what the browser checks of selling
// without internet need — evaluate code in the page, wait for something to show, take a screenshot, cut the network,
// and open a second tab of the same browser profile (they share IndexedDB and Web Locks, like two windows of the app).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  const found = candidates.find((p) => p && fs.existsSync(p))
  if (!found) throw new Error('No encuentro Google Chrome: instálalo o indica su ruta en la variable CHROME_PATH')
  return found
}

/** Drives one tab of a running Chrome. */
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve) => (ws.onopen = resolve))
  let id = 0
  const pending = new Map()
  const logs = []
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) pending.get(d.id)(d)
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text))
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id
      pending.set(i, resolve)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  /** Runs an expression in the page (promises are awaited) and returns its value. */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error('en la página: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text))
    return r.result?.result?.value
  }
  /** Polls an expression until it is truthy: { ok, ms, value }. */
  const waitFor = async (expression, ms) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      try {
        const value = await ev(expression)
        if (value) return { ok: true, ms: Date.now() - t0, value }
      } catch {
        // The page is navigating.
      }
      await sleep(250)
    }
    return { ok: false, ms: Date.now() - t0 }
  }
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  }
  const setNetwork = (offline) => send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  return { send, ev, waitFor, shot, setNetwork, logs, closeSocket: () => ws.close() }
}

/** Opens a fresh headless Chrome (own profile, so no IndexedDB or service worker of an earlier run survives). */
export async function launchChrome({ width = 1366, height = 800 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-check-'))
  const port = 9300 + Math.floor(Math.random() * 600)
  const proc = spawn(findChrome(), ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' })
  let targets
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {
      // Chrome is still starting.
    }
    await sleep(200)
  }
  const page = targets?.find((t) => t.type === 'page')
  if (!page) {
    proc.kill()
    throw new Error('Chrome no arrancó')
  }
  const first = await attach(page.webSocketDebuggerUrl)
  const tabs = [first]
  return {
    ...first,
    /** Another tab of the same browser (same IndexedDB, same Web Locks). */
    async newTab(url = 'about:blank') {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
      const tab = await attach(target.webSocketDebuggerUrl)
      tabs.push(tab)
      return tab
    },
    close() {
      for (const t of tabs) {
        try {
          t.closeSocket()
        } catch {
          // Already closed.
        }
      }
      proc.kill()
    },
  }
}
