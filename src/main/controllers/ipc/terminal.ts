import { ipcMain } from 'electron'
import type { SessionManager } from '@/main/services/session-manager'
import { logger } from '@/main/lib/logger'
import { ZodError } from 'zod'
import { SessionNotFoundError } from '@/main/lib/errors'
import { IPC } from '@/shared/types/constants'
import { SessionIdSchema } from '@/shared/schemas/session'
import type { ValidateSender } from '@/main/types/ipc'
import { MAX_INPUT_LENGTH } from '@/main/types/constants'

export function registerTerminalHandlers(
  sessionManager: SessionManager,
  validateSender: ValidateSender
): void {
  ipcMain.on(IPC.TERMINAL_INPUT, (event, id: unknown, data: unknown) => {
    try {
      validateSender(event)
      const sessionId = SessionIdSchema.parse(id)
      if (typeof data !== 'string' || data.length === 0) {
        throw new Error('Invalid data: expected non-empty string')
      }
      if (data.length > MAX_INPUT_LENGTH) {
        throw new Error('Input exceeds maximum allowed length')
      }
      sessionManager.write(sessionId, data)
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        logger.warn('Terminal input for unknown session', { error: err })
      } else if (err instanceof ZodError) {
        logger.warn('Terminal input validation failed', { error: err })
      } else {
        logger.error('Unexpected error in terminal input handler', {
          error: err
        })
      }
    }
  })
}
