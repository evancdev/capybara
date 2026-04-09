import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { logger } from '@/main/lib/logger'

let mainWindow: BrowserWindow | null = null

/**
 * Returns the path to the app's public assets directory.
 *
 * In production, uses Electron's `resources/` directory inside the app bundle.
 * 
 * In development, resolves two levels up from `out/main/` to the project root's `public/` folder.
 */
export function getPublicPath(): string {
  return app.isPackaged
    ? process.resourcesPath
    : join(__dirname, '../../public')
}

/** Returns the platform-appropriate window icon path (.ico on Windows, .png elsewhere). */
function getWindowIcon(): string {
  const publicDir = getPublicPath()
  switch (process.platform) {
    case 'win32':
      return join(publicDir, 'icon.ico')
    default:
      return join(publicDir, 'icon.png')
  }
}

/** Creates the main BrowserWindow. Loads the Vite dev server in development, compiled HTML in production. */
export function createWindow(): BrowserWindow {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  const window = new BrowserWindow({
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
      ? window.loadURL(rendererUrl)
      : window.loadFile(join(__dirname, '../renderer/index.html'))

  loadPromise.catch((error: unknown) => {
    const target = rendererUrl ?? 'renderer/index.html'
    logger.error(`Failed to load window content from "${target}".`, { error })
  })

  window.on('closed', () => {
    mainWindow = null
  })

  mainWindow = window
  return window
}

/** Returns the current main window reference. */
export function getWindow(): BrowserWindow | null {
  return mainWindow
}
