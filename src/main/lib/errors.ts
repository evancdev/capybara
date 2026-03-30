export class BaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class SessionNotFoundError extends BaseError {
  constructor(id: string) {
    super(`Session not found: ${id}`)
  }
}

export class CwdValidationError extends BaseError {}
