// Starts and stops what the browser checks of selling without internet need: the in-memory API with its Supabase
// stand-in (apiServer.ts), a Vite dev server for the check page, or a production build served like the real app.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PORTS = {
  api: Number(process.env.OFFLINE_CHECK_API_PORT ?? 3002),
  supa: Number(process.env.OFFLINE_CHECK_SUPA_PORT ?? 3003),
  vite: Number(process.env.OFFLINE_CHECK_VITE_PORT ?? 5174),
  preview: Number(process.env.OFFLINE_CHECK_PREVIEW_PORT ?? 4180),
}
const VITE = path.join(ROOT, 'node_modules/vite/bin/vite.js')
const children = []

/** Starts a Node process and resolves once it prints something matching `ready`. */
function start(label, args, env, ready) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let out = ''
    const timer = setTimeout(() => reject(new Error(`${label} no arrancó en 60 s:\n${out}`)), 60_000)
    const onData = (d) => {
      out += d.toString()
      // Vite colours its messages: the escape codes can sit in the middle of the words that are waited for.
      // oxlint-disable-next-line no-control-regex
      if (ready.test(out.replace(/\x1b\[[0-9;]*m/g, ''))) {
        clearTimeout(timer)
        resolve(child)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`${label} terminó (código ${code}):\n${out}`))
    })
  })
}

export const apiUrl = () => `http://127.0.0.1:${PORTS.api}`

/** The real API on an in-memory database, plus the Supabase stand-in. */
export const startApi = () => start('el servidor de prueba', ['--import', 'tsx', 'scripts/offline-check/apiServer.ts'], { API_PORT: PORTS.api, SUPA_PORT: PORTS.supa }, /READY/)

/** Vite's dev server (the page of the module check imports the app's own source). */
export const startViteDev = () => start('Vite', [VITE, '--port', String(PORTS.vite), '--strictPort'], { VITE_API_URL: apiUrl() }, /ready in/)

/** Builds the app the way production does, but pointed at the test servers. `packaged`: the installed-app variant. */
export function buildApp(outDir, { packaged = false, key = 'anon-test' } = {}) {
  const env = {
    ...process.env,
    VITE_SUPABASE_URL: `http://127.0.0.1:${PORTS.supa}`,
    VITE_SUPABASE_PUBLISHABLE_KEY: key, // (a different key makes a different build: how the update check tells versions apart)
    VITE_API_URL: apiUrl(),
    ...(packaged ? { VITE_PACKAGED: '1' } : {}),
  }
  const r = spawnSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, env, encoding: 'utf8' })
  if (r.status !== 0) throw new Error('vite build falló:\n' + r.stdout + r.stderr)
}

/** Serves a build like Firebase Hosting would (service worker included). */
export const startPreview = (outDir) => start('el servidor de la compilación', [VITE, 'preview', '--outDir', outDir, '--port', String(PORTS.preview), '--strictPort'], {}, /Local:/)

export function stopAll() {
  for (const c of children) {
    try {
      c.kill()
    } catch {
      // Already gone.
    }
  }
}

/** Calls the test API's controls (see apiServer.ts). */
export async function control(route, body) {
  const res = await fetch(apiUrl() + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return res.json()
}
