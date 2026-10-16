// Builds the Windows installer: the web app in its installed form (VITE_PACKAGED=1) inside an Electron shell, wrapped
// by Inno Setup into desktop/out/Plastimax-FR-<version>-Setup.exe. From the repo root: `npm run build:exe`.
// The first run downloads Electron (~120 MB, cached afterwards) and needs Inno Setup 6 (winget install -e --id
// JRSoftware.InnoSetup --source winget). The version is the one in desktop/package.json: raise it for a new release.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const ELECTRON = '44.7.1'
const SITE = 'https://plastimax-fr.web.app' // the API the installed app talks to, and what a receipt's WhatsApp link opens

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const build = path.join(here, 'build')
const out = path.join(here, 'out')
const { version } = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'))
const run = (cmd, args, env) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })

fs.rmSync(build, { recursive: true, force: true })
const stage = path.join(build, 'app')

console.log('==> Revisando tipos y compilando la app (versión instalada, hacia ' + SITE + ')')
run(process.execPath, ['node_modules/typescript/bin/tsc', '-b'])
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', path.join(stage, 'web')], { VITE_PACKAGED: '1', VITE_API_URL: SITE, VITE_PUBLIC_URL: SITE })
fs.copyFileSync(path.join(here, 'main.cjs'), path.join(stage, 'main.cjs'))
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'plastimax-fr', productName: 'Plastimax F.R.', version, main: 'main.cjs' }))

console.log('==> Armando Plastimax.exe con Electron ' + ELECTRON)
const [packed] = await packager({
  dir: stage,
  out: path.join(build, 'pack'),
  name: 'Plastimax',
  platform: 'win32',
  arch: 'x64',
  electronVersion: ELECTRON,
  icon: path.join(here, 'icon.ico'),
  appCopyright: 'Plastimax F.R.',
  win32metadata: { CompanyName: 'Plastimax F.R.', FileDescription: 'Plastimax F.R.', ProductName: 'Plastimax F.R.', OriginalFilename: 'Plastimax.exe' },
  asar: true,
  prune: false,
  overwrite: true,
})
// Chromium's translations are ~40 MB: the app is in Spanish, and anything missing falls back to English.
const locales = path.join(packed, 'locales')
for (const f of fs.readdirSync(locales)) if (!/^(es|es-419|en-US)\.pak$/.test(f)) fs.rmSync(path.join(locales, f))

console.log('==> Instalador (Inno Setup)')
const iscc = [path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Inno Setup 6/ISCC.exe'), path.join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6/ISCC.exe')].find((p) => fs.existsSync(p))
if (!iscc) throw new Error('Falta Inno Setup: winget install -e --id JRSoftware.InnoSetup --source winget')
fs.mkdirSync(out, { recursive: true })
run(iscc, ['/Q', `/DVersion=${version}`, `/DOrigen=${packed}`, `/O${out}`, path.join(here, 'installer.iss')])
console.log('==> Listo: ' + path.join(out, `Plastimax-FR-${version}-Setup.exe`))
