import { describe, it, expect } from 'vitest'
import {
  BaseError,
  SessionNotFoundError,
  CwdValidationError,
  SessionLimitError,
  UnauthorizedSenderError,
  UnknownSlashCommandError,
  InvalidCommandArgsError
} from '@/main/lib/errors'
import { TEST_UUIDS } from '../../fixtures/uuids'

class ConcreteBaseError extends BaseError {
  publicMessage = 'concrete error'
}

// ---------------------------------------------------------------------------
// BaseError (via ConcreteBaseError)
// ---------------------------------------------------------------------------
describe('BaseError', () => {
  it('sets name to the concrete subclass name', () => {
    const err = new ConcreteBaseError('test message')
    expect(err.name).toBe('ConcreteBaseError')
  })

  it('sets message correctly', () => {
    const err = new ConcreteBaseError('something went wrong')
    expect(err.message).toBe('something went wrong')
  })

  it('is an instance of Error', () => {
    const err = new ConcreteBaseError('test')
    expect(err).toBeInstanceOf(Error)
  })

  it('is an instance of BaseError', () => {
    const err = new ConcreteBaseError('test')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('has a stack trace', () => {
    const err = new ConcreteBaseError('test')
    expect(err.stack).toBeDefined()
  })

  it('defaults logLevel to warn', () => {
    const err = new ConcreteBaseError('test')
    expect(err.logLevel).toBe('warn')
  })
})

// ---------------------------------------------------------------------------
// SessionNotFoundError
// ---------------------------------------------------------------------------
describe('SessionNotFoundError', () => {
  it('sets name to SessionNotFoundError', () => {
    const err = new SessionNotFoundError('abc-123')
    expect(err.name).toBe('SessionNotFoundError')
  })

  it('includes sessionId in the message', () => {
    const sessionId = TEST_UUIDS.session
    const err = new SessionNotFoundError(sessionId)
    expect(err.message).toContain(sessionId)
  })

  it('formats message as "Session not found: <id>"', () => {
    const err = new SessionNotFoundError('test-id')
    expect(err.message).toBe('Session not found: test-id')
  })

  it('exposes publicMessage "Session not found"', () => {
    const err = new SessionNotFoundError('abc')
    expect(err.publicMessage).toBe('Session not found')
  })

  it('is an instance of BaseError and Error', () => {
    const err = new SessionNotFoundError('abc')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })

  it('is not an instance of TypeError or RangeError', () => {
    const err = new SessionNotFoundError('abc')
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err).not.toBeInstanceOf(RangeError)
  })

  it('can be caught as BaseError', () => {
    let caught = false
    try {
      throw new SessionNotFoundError('xyz')
    } catch (err) {
      if (err instanceof BaseError) {
        caught = true
      }
    }
    expect(caught).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CwdValidationError
// ---------------------------------------------------------------------------
describe('CwdValidationError', () => {
  it('sets name to CwdValidationError', () => {
    const err = new CwdValidationError('Working directory is not allowed')
    expect(err.name).toBe('CwdValidationError')
  })

  it('preserves the provided message', () => {
    const err = new CwdValidationError('Working directory is not allowed')
    expect(err.message).toBe('Working directory is not allowed')
  })

  it('exposes publicMessage "Invalid directory"', () => {
    const err = new CwdValidationError('test')
    expect(err.publicMessage).toBe('Invalid directory')
  })

  it('is an instance of BaseError and Error', () => {
    const err = new CwdValidationError('test')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })

  it('is not an instance of SessionNotFoundError', () => {
    const err = new CwdValidationError('test')
    expect(err).not.toBeInstanceOf(SessionNotFoundError)
  })
})

// ---------------------------------------------------------------------------
// SessionLimitError
// ---------------------------------------------------------------------------
describe('SessionLimitError', () => {
  it('sets name to SessionLimitError', () => {
    const err = new SessionLimitError('Maximum reached')
    expect(err.name).toBe('SessionLimitError')
  })

  it('uses the constructor message as both message and publicMessage', () => {
    const err = new SessionLimitError('Max of 20 sessions reached')
    expect(err.message).toBe('Max of 20 sessions reached')
    expect(err.publicMessage).toBe('Max of 20 sessions reached')
  })

  it('is an instance of BaseError and Error', () => {
    const err = new SessionLimitError('limit')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// UnauthorizedSenderError
// ---------------------------------------------------------------------------
describe('UnauthorizedSenderError', () => {
  it('sets name to UnauthorizedSenderError', () => {
    const err = new UnauthorizedSenderError()
    expect(err.name).toBe('UnauthorizedSenderError')
  })

  it('has internal message about main window', () => {
    const err = new UnauthorizedSenderError()
    expect(err.message).toBe('IPC sender is not the main window')
  })

  it('exposes publicMessage "Unauthorized"', () => {
    const err = new UnauthorizedSenderError()
    expect(err.publicMessage).toBe('Unauthorized')
  })

  it('has logLevel error (not warn)', () => {
    const err = new UnauthorizedSenderError()
    expect(err.logLevel).toBe('error')
  })

  it('is an instance of BaseError and Error', () => {
    const err = new UnauthorizedSenderError()
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// UnknownSlashCommandError
// ---------------------------------------------------------------------------
describe('UnknownSlashCommandError', () => {
  it('sets name to UnknownSlashCommandError', () => {
    const err = new UnknownSlashCommandError('bogus')
    expect(err.name).toBe('UnknownSlashCommandError')
  })

  it('includes the command name in the internal message', () => {
    const err = new UnknownSlashCommandError('bogus')
    expect(err.message).toBe('Unknown slash command: bogus')
  })

  it('formats publicMessage with a leading slash', () => {
    const err = new UnknownSlashCommandError('bogus')
    expect(err.publicMessage).toBe('Unknown command: /bogus')
  })

  it('is an instance of BaseError and Error', () => {
    const err = new UnknownSlashCommandError('x')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })

  it('has logLevel warn', () => {
    const err = new UnknownSlashCommandError('x')
    expect(err.logLevel).toBe('warn')
  })
})

// ---------------------------------------------------------------------------
// InvalidCommandArgsError
// ---------------------------------------------------------------------------
describe('InvalidCommandArgsError', () => {
  it('sets name to InvalidCommandArgsError', () => {
    const err = new InvalidCommandArgsError('Usage: /model <name>')
    expect(err.name).toBe('InvalidCommandArgsError')
  })

  it('uses constructor message as both message and publicMessage', () => {
    const msg = 'Usage: /model <name>'
    const err = new InvalidCommandArgsError(msg)
    expect(err.message).toBe(msg)
    expect(err.publicMessage).toBe(msg)
  })

  it('is an instance of BaseError and Error', () => {
    const err = new InvalidCommandArgsError('test')
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })

  it('has logLevel warn', () => {
    const err = new InvalidCommandArgsError('test')
    expect(err.logLevel).toBe('warn')
  })
})
