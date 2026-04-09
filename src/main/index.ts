import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import fs from 'node:fs'
import { createWindow, getPublicPath } from '@/main/bootstrap/window'
import { SessionService } from '@/main/services/session'
import { MAIN_COMMANDS } from '@/main/services/slash-commands'
import { ClaudeConnection } from '@/main/claude/connection'
import {
  listConversations,
  loadConversationMessages,
  renameConversation
} from '@/main/claude/history'
import os from 'node:os'
import { registerIpc } from '@/main/ipc'
import { sendToRenderer } from '@/main/ipc/transport'
import { IPC } from '@/shared/types/constants'
import { logger, setErrorSink } from '@/main/lib/logger'

const SHUTDOWN_TIMEOUT_MS = 5_000
const sessionService = new SessionService({
  connectionFactory: (ctx) => new ClaudeConnection(ctx),
  conversations: {
    listConversations,
    loadConversationMessages,
    renameConversation
  },
  mainCommands: MAIN_COMMANDS
})
let isShuttingDown = false
let errorLogStream: fs.WriteStream | null = null

/**
 * Open the per-user error log file and install it as the logger's error sink.
 * Only errors go here — info/warn stay on the console. Failure to open the
 * file is non-fatal: we just fall back to console-only for this run.
 */
function installErrorLogSink(): void {
  try {
    const logsDir = app.getPath('logs')
    fs.mkdirSync(logsDir, { recursive: true })
    const logPath = join(logsDir, 'error.log')
    errorLogStream = fs.createWriteStream(logPath, { flags: 'a' })
    setErrorSink((line, context) => {
      const suffix =
        context !== undefined ? ` ${JSON.stringify(context)}` : ''
      errorLogStream?.write(`${line}${suffix}\n`)
    })
    logger.info('Error log sink installed', { logPath })
  } catch (err: unknown) {
    logger.warn('Failed to install error log sink — console only', {
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/** Detach the sink and flush/close the error log stream. Idempotent. */
function closeErrorLogSink(): void {
  setErrorSink(null)
  if (errorLogStream) {
    try {
      errorLogStream.end()
    } catch {
      // Ignore — we're shutting down anyway.
    }
    errorLogStream = null
  }
}

/** Destroys all sessions and quits the app. Re-entrant safe via the isShuttingDown guard. Force-exits after 5s if shutdown hangs. */
function gracefulShutdown(): void {
  if (isShuttingDown) return
  isShuttingDown = true

  setTimeout(() => {
    logger.error(
      `Graceful shutdown timed out after ${
        SHUTDOWN_TIMEOUT_MS / 1000
      } seconds. Forcing exit.`
    )
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS).unref()

  sessionService.destroyAll()
  closeErrorLogSink()
  app.quit()
}

// App bootstrap — runs once Electron has finished initializing.
void app.whenReady().then(() => {
  installErrorLogSink()
  logger.info('Capybara started')

  // macOS ignores BrowserWindow.icon — set the dock icon manually in dev.
  if (!app.isPackaged && process.platform === 'darwin' && app.dock !== undefined) {
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
          [
            "default-src 'self'",
            `script-src ${scriptSrc}`,
            "style-src 'self' 'unsafe-inline'",
            `connect-src ${connectSrc}`,
            "img-src 'self'",
            "font-src 'self'",
            "worker-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'none'"
          ].join('; ')
        ]
      }
    })
  })

  registerIpc(sessionService)
  const mainWindow = createWindow()
  mainWindow.webContents.on('did-finish-load', () => {
    sendToRenderer(IPC.USER_INFO, {
      username: os.userInfo().username,
      hostname: os.hostname().replace(/\.local$/, ''),
      homedir: os.homedir()
    })
  })

  // macOS: re-create the window when the dock icon is clicked and no windows exist.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  gracefulShutdown()
})

app.on('window-all-closed', () => {
  // Kill all sessions on macOS too — they'd run invisibly with no UI.
  sessionService.destroyAll()

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
