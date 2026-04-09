import { ipcMain } from 'electron'
import { ZodError } from 'zod'
import { BaseError, UnauthorizedSenderError } from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'
import { getWindow } from '@/main/bootstrap/window'

/**
 * Registers an IPC handler. Automatically validates the sender (main window only)
 * and normalizes thrown errors before they reach the renderer.
 *
 * The handler callback receives only the payload args — the raw Electron event is
 * consumed internally for authorization and not forwarded, so handlers stay focused
 * on business logic.
 */
export function handle(
  channel: string,
  handler: (...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      validateSender(event)
      return await handler(...args)
    } catch (err) {
      if (err instanceof BaseError) {
        const logMessage = `IPC ${err.name} on ${channel}`
        const logContext = { error: err.stack ?? err.message }
        if (err.logLevel === 'error') {
          logger.error(logMessage, logContext)
        } else {
          logger.warn(logMessage, logContext)
        }
        throw new Error(err.publicMessage)
      }
      if (err instanceof ZodError) {
        logger.warn(`IPC validation failed on ${channel}`, {
          error: err.message
        })
        throw new Error('Invalid input')
      }
      logger.error(`Unhandled error in IPC handler on ${channel}`, {
        error: err
      })
      throw new Error('Internal error')
    }
  })
}

/** Throws UnauthorizedSenderError if the IPC event did not originate from the main window. */
function validateSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
): void {
  const window = getWindow()
  if (window?.webContents.id !== event.sender.id) {
    throw new UnauthorizedSenderError()
  }
}

/** Sends a message to the renderer, skipping if the window is gone. */
export function sendToRenderer(
  channel: string,
  ...args: unknown[]
): void {
  const window = getWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, ...args)
  }
}
