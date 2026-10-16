// Plastimax F.R. for Windows: the web app built with VITE_PACKAGED=1 (see vite.config.ts) in a window of its own.
// This shell has no code of the store's and the page has no Node: sign-in, data and every rule stay the page's
// and the server's, exactly as in the browser.
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ORIGIN = 'app://plastimax'
const WEB = path.join(__dirname, 'web')

// The page is served from an address of its own, not from file://: there it is a secure context like the site
// (IndexedDB, Web Locks, fetch of its own files), which is how check:offline-app tests the installed build.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

app.commandLine.appendSwitch('lang', 'es-419') // date pickers and the like in Spanish whatever Windows' language is
app.setAppUserModelId('co.plastimax.fr')

let win = null

/** Links go to the PC's browser (WhatsApp included), never into this window. */
const openOutside = (url) => {
  if (/^(https?|mailto|whatsapp):/i.test(url)) void shell.openExternal(url)
}

app.on('web-contents-created', (_, contents) => {
  // A receipt's WhatsApp button opens `window.open('')` inside the click and sets its address later: that blank
  // window is only a stand-in, so it stays hidden and, the moment it is sent anywhere, the address goes to the
  // browser and it closes. Whatever else tries to leave the app's own address goes to the browser too.
  contents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') return { action: 'allow', overrideBrowserWindowOptions: { show: false } }
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/')) return
    e.preventDefault()
    openOutside(url)
    if (contents !== win?.webContents) BrowserWindow.fromWebContents(contents)?.close()
  })
})

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true, // Alt shows it; the shortcuts work all the same
    title: 'Plastimax F.R.',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.on('closed', () => app.quit()) // a stand-in window that was never used must not keep the app alive
  void win.loadURL(ORIGIN + '/index.html')
}

if (!app.requestSingleInstanceLock()) {
  app.quit() // already open: it is that window that comes to the front
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(() => {
    protocol.handle('app', (req) => {
      const file = path.join(WEB, decodeURIComponent(new URL(req.url).pathname))
      if (!file.startsWith(WEB + path.sep)) return new Response('', { status: 403 })
      return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('', { status: 404 }))
    })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'Ver',
          submenu: [
            { role: 'reload', label: 'Recargar' },
            { role: 'togglefullscreen', label: 'Pantalla completa' },
            { type: 'separator' },
            { role: 'zoomIn', label: 'Acercar' },
            { role: 'zoomOut', label: 'Alejar' },
            { role: 'resetZoom', label: 'Tamaño normal' },
          ],
        },
      ]),
    )
    createWindow()
  })
}
