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

export class UnknownSlashCommandError extends BaseError {
  publicMessage: string
  constructor(name: string) {
    super(`Unknown slash command: ${name}`)
    this.publicMessage = `Unknown command: /${name}`
  }
}

export class InvalidCommandArgsError extends BaseError {
  publicMessage: string
  constructor(message: string) {
    super(message)
    this.publicMessage = message
  }
}

export class CircularInterAgentCallError extends BaseError {
  publicMessage = 'Circular inter-agent call detected'
  constructor(fromId: string, toId: string) {
    super(
      `Circular inter-agent call: ${fromId} -> ${toId} while ${toId} -> ${fromId} is in flight`
    )
  }
}

export class MaxHopsExceededError extends BaseError {
  publicMessage = 'Max inter-agent hops exceeded'
  constructor(depth: number) {
    super(`Max inter-agent hops exceeded (depth=${depth})`)
  }
}

export class TargetSessionExitedError extends BaseError {
  publicMessage = 'Target session exited before replying'
  constructor(targetId: string) {
    super(`Target session ${targetId} exited before replying`)
  }
}

export class UnauthorizedSenderError extends BaseError {
  publicMessage = 'Unauthorized'
  logLevel: 'warn' | 'error' = 'error'
  constructor() {
    super('IPC sender is not the main window')
  }
}
