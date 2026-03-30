import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { SessionManager } from '@/main/services/session-manager'
import { registerIpcHandlers } from '@/main/controllers/ipc'
import { logger } from '@/main/lib/logger'

const sessionManager = new SessionManager()
let mainWindow: BrowserWindow | null = null
let isShuttingDown = false

function getPublicPath(): string {
  return app.isPackaged
    ? process.resourcesPath
    : join(__dirname, '../../public')
}

function getWindowIcon(): string {
  const publicDir = getPublicPath()
  switch (process.platform) {
    case 'win32':
      return join(publicDir, 'icon.ico')
    default:
      return join(publicDir, 'icon.png')
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: getWindowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    },
    titleBarStyle: 'hiddenInset',
    title: 'Capybara'
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const loadPromise =
    !app.isPackaged && rendererUrl !== undefined && rendererUrl !== ''
      ? win.loadURL(rendererUrl)
      : win.loadFile(join(__dirname, '../renderer/index.html'))

  loadPromise.catch((error: unknown) => {
    const target = rendererUrl ?? 'renderer/index.html'
    logger.error(`Failed to load window content from "${target}".`, { error })
  })

  mainWindow = win
  return win
}

function gracefulShutdown(): void {
  if (isShuttingDown) return
  isShuttingDown = true

  setTimeout(() => process.exit(1), 5000).unref()
  sessionManager.destroyAll()
  app.quit()
}

void app.whenReady().then(() => {
  logger.info('Capybara started')

  // On macOS, BrowserWindow's `icon` property is ignored — the dock icon
  // must be set explicitly. `app.dock` only exists on darwin.
  if (process.platform === 'darwin') {
    app.dock.setIcon(join(getPublicPath(), 'icon.png'))
  }

  // Dev mode loosens CSP for Vite's inline scripts and HMR WebSocket.
  const scriptSrc = app.isPackaged ? "'self'" : "'self' 'unsafe-inline'"
  const connectSrc = app.isPackaged ? "'self'" : "'self' ws:"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self'; font-src 'self'; worker-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'`
        ]
      }
    })
  })

  // Must only be called once — not on window re-create
  registerIpcHandlers(sessionManager, () => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// app.quit() re-emits 'before-quit', so this re-enters gracefulShutdown().
// The isShuttingDown guard prevents an infinite loop.
app.on('before-quit', () => {
  gracefulShutdown()
})

app.on('window-all-closed', () => {
  // Kill pty sessions on macOS too — they'd run invisibly with no UI.
  sessionManager.destroyAll()

  if (process.platform !== 'darwin') {
    gracefulShutdown()
  }
})

process.on('SIGTERM', () => {
  gracefulShutdown()
})
process.on('SIGINT', () => {
  gracefulShutdown()
})

process.on('unhandledRejection', (reason: unknown) => {
  const detail =
    reason instanceof Error
      ? { error: reason.stack ?? reason.message }
      : { reason }
  logger.error('A promise was rejected without a catch handler.', detail)
})

process.on('uncaughtException', (error: Error, origin: string) => {
  logger.error(
    `Uncaught exception from "${origin}". Initiating graceful shutdown.`,
    {
      error: error.stack ?? error.message
    }
  )
  gracefulShutdown()
})
