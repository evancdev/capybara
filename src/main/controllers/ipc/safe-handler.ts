import { ipcMain } from 'electron'
import { ZodError } from 'zod'
import { SessionNotFoundError, CwdValidationError } from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'

// Registers an IPC handler with automatic error normalization.
// Errors are logged server-side and sanitized before reaching the renderer.
export function handle(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      if (err instanceof ZodError) {
        logger.warn(`IPC validation failed on ${channel}`, {
          error: err.message
        })
        throw new Error('Invalid input')
      }
      if (err instanceof SessionNotFoundError) {
        logger.warn(`IPC session not found on ${channel}`, {
          error: err.message
        })
        throw new Error('Session not found')
      }
      if (err instanceof CwdValidationError) {
        logger.warn(`IPC cwd validation failed on ${channel}`, {
          error: err.message
        })
        throw new Error(err.message)
      }
      logger.error(`Unhandled error in IPC handler on ${channel}`, {
        error: err
      })
      throw new Error('Internal error')
    }
  })
}
