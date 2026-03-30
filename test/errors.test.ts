import { describe, it, expect } from 'vitest'
import { BaseError, SessionNotFoundError, CwdValidationError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// BaseError
// ---------------------------------------------------------------------------
describe('BaseError', () => {
  it('sets name to the constructor name', () => {
    const err = new BaseError('test message')
    expect(err.name).toBe('BaseError')
  })

  it('sets message correctly', () => {
    const err = new BaseError('something went wrong')
    expect(err.message).toBe('something went wrong')
  })

  it('is an instance of Error', () => {
    const err = new BaseError('test')
    expect(err).toBeInstanceOf(Error)
  })

  it('is an instance of BaseError', () => {
    const err = new BaseError('test')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('has a stack trace', () => {
    const err = new BaseError('test')
    expect(err.stack).toBeDefined()
    expect(err.stack).toContain('BaseError')
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
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    const err = new SessionNotFoundError(sessionId)
    expect(err.message).toContain(sessionId)
  })

  it('formats message as "Session not found: <id>"', () => {
    const err = new SessionNotFoundError('test-id')
    expect(err.message).toBe('Session not found: test-id')
  })

  it('is an instance of BaseError', () => {
    const err = new SessionNotFoundError('abc')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('is an instance of Error', () => {
    const err = new SessionNotFoundError('abc')
    expect(err).toBeInstanceOf(Error)
  })

  it('is not an instance of TypeError or other built-in error types', () => {
    const err = new SessionNotFoundError('abc')
    expect(err).not.toBeInstanceOf(TypeError)
    expect(err).not.toBeInstanceOf(RangeError)
  })

  it('can be caught as BaseError in a catch block', () => {
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

  it('is an instance of BaseError', () => {
    const err = new CwdValidationError('test')
    expect(err).toBeInstanceOf(BaseError)
  })

  it('is an instance of Error', () => {
    const err = new CwdValidationError('test')
    expect(err).toBeInstanceOf(Error)
  })

  it('is not an instance of SessionNotFoundError', () => {
    const err = new CwdValidationError('test')
    expect(err).not.toBeInstanceOf(SessionNotFoundError)
  })

  it('can be caught as BaseError in a catch block', () => {
    let caught = false
    try {
      throw new CwdValidationError('not allowed')
    } catch (err) {
      if (err instanceof BaseError) {
        caught = true
      }
    }
    expect(caught).toBe(true)
  })
})
