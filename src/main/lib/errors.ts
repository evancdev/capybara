/**
 * Base for domain errors. Subclasses self-describe via `publicMessage` and
 * `logLevel` so `transport.ts` never branches on error type.
 */
export abstract class BaseError extends Error {
  abstract publicMessage: string
  logLevel: 'warn' | 'error' = 'warn'

  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class SessionNotFoundError extends BaseError {
  publicMessage = 'Session not found'
  constructor(id: string) {
    super(`Session not found: ${id}`)
  }
}

export class CwdValidationError extends BaseError {
  publicMessage = 'Invalid directory'
}

export class SessionLimitError extends BaseError {
  publicMessage: string
  constructor(message: string) {
    super(message)
    this.publicMessage = message
  }
}

export class UnauthorizedSenderError extends BaseError {
  publicMessage = 'Unauthorized'
  logLevel: 'warn' | 'error' = 'error'
  constructor() {
    super('IPC sender is not the main window')
  }
}
