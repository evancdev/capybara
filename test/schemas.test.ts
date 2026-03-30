import { describe, it, expect } from 'vitest'
import {
  CreateSessionSchema,
  ResizeSchema,
  RenameSchema,
  SessionIdSchema
} from '@/shared/schemas/session'

// ---------------------------------------------------------------------------
// CreateSessionSchema
// ---------------------------------------------------------------------------
describe('CreateSessionSchema', () => {
  it('accepts valid input with cwd only', () => {
    const result = CreateSessionSchema.parse({ cwd: '/Users/test/project' })
    expect(result).toEqual({ cwd: '/Users/test/project' })
  })

  it('accepts valid input with cwd and name', () => {
    const result = CreateSessionSchema.parse({ cwd: '/tmp', name: 'my-session' })
    expect(result).toEqual({ cwd: '/tmp', name: 'my-session' })
  })

  it('rejects missing cwd', () => {
    expect(() => CreateSessionSchema.parse({})).toThrow()
  })

  it('rejects non-string cwd', () => {
    expect(() => CreateSessionSchema.parse({ cwd: 123 })).toThrow()
  })

  it('rejects empty cwd string', () => {
    expect(() => CreateSessionSchema.parse({ cwd: '' })).toThrow()
  })

  it('allows omitting name (optional field)', () => {
    const result = CreateSessionSchema.parse({ cwd: '/home/user' })
    expect(result.name).toBeUndefined()
  })

  it('rejects empty name when provided', () => {
    expect(() => CreateSessionSchema.parse({ cwd: '/home/user', name: '' })).toThrow()
  })

  it('rejects non-string name', () => {
    expect(() => CreateSessionSchema.parse({ cwd: '/home/user', name: 42 })).toThrow()
  })

  it('strips unknown properties', () => {
    const result = CreateSessionSchema.parse({ cwd: '/tmp', extra: true })
    expect(result).not.toHaveProperty('extra')
  })

  it('accepts name at exactly max length of 40', () => {
    const maxName = 'a'.repeat(40)
    const result = CreateSessionSchema.parse({ cwd: '/tmp', name: maxName })
    expect(result.name).toBe(maxName)
  })

  it('rejects name exceeding max length of 40', () => {
    expect(() =>
      CreateSessionSchema.parse({ cwd: '/tmp', name: 'a'.repeat(41) })
    ).toThrow()
  })

  it('rejects null cwd', () => {
    expect(() => CreateSessionSchema.parse({ cwd: null })).toThrow()
  })

  it('accepts valid resumeConversationId (UUID)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const result = CreateSessionSchema.parse({ cwd: '/tmp', resumeConversationId: uuid })
    expect(result.resumeConversationId).toBe(uuid)
  })

  it('allows omitting resumeConversationId (optional)', () => {
    const result = CreateSessionSchema.parse({ cwd: '/tmp' })
    expect(result.resumeConversationId).toBeUndefined()
  })

  it('rejects non-UUID resumeConversationId', () => {
    expect(() =>
      CreateSessionSchema.parse({ cwd: '/tmp', resumeConversationId: 'not-a-uuid' })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ResizeSchema
// ---------------------------------------------------------------------------
describe('ResizeSchema', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

  it('accepts valid input', () => {
    const result = ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: 24 })
    expect(result).toEqual({ sessionId: VALID_UUID, cols: 80, rows: 24 })
  })

  it('rejects zero cols', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 0, rows: 24 })).toThrow()
  })

  it('rejects zero rows', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: 0 })).toThrow()
  })

  it('rejects negative cols', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: -1, rows: 24 })).toThrow()
  })

  it('rejects negative rows', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: -5 })).toThrow()
  })

  it('rejects missing sessionId', () => {
    expect(() => ResizeSchema.parse({ cols: 80, rows: 24 })).toThrow()
  })

  it('rejects missing cols', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, rows: 24 })).toThrow()
  })

  it('rejects missing rows', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80 })).toThrow()
  })

  it('rejects floating point cols', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80.5, rows: 24 })).toThrow()
  })

  it('rejects floating point rows', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: 24.7 })).toThrow()
  })

  it('rejects empty sessionId', () => {
    expect(() => ResizeSchema.parse({ sessionId: '', cols: 80, rows: 24 })).toThrow()
  })

  it('rejects non-UUID sessionId', () => {
    expect(() => ResizeSchema.parse({ sessionId: 'abc-123', cols: 80, rows: 24 })).toThrow()
  })

  it('accepts cols at max boundary (500)', () => {
    const result = ResizeSchema.parse({ sessionId: VALID_UUID, cols: 500, rows: 24 })
    expect(result.cols).toBe(500)
  })

  it('rejects cols exceeding max (501)', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 501, rows: 24 })).toThrow()
  })

  it('accepts rows at max boundary (200)', () => {
    const result = ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: 200 })
    expect(result.rows).toBe(200)
  })

  it('rejects rows exceeding max (201)', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: 201 })).toThrow()
  })

  it('rejects string cols', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: '80', rows: 24 })).toThrow()
  })

  it('rejects string rows', () => {
    expect(() => ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: '24' })).toThrow()
  })

  it('strips unknown properties', () => {
    const result = ResizeSchema.parse({ sessionId: VALID_UUID, cols: 80, rows: 24, extra: true })
    expect(result).not.toHaveProperty('extra')
  })
})

// ---------------------------------------------------------------------------
// RenameSchema
// ---------------------------------------------------------------------------
describe('RenameSchema', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

  it('accepts valid input', () => {
    const result = RenameSchema.parse({ sessionId: VALID_UUID, name: 'New Name' })
    expect(result).toEqual({ sessionId: VALID_UUID, name: 'New Name' })
  })

  it('accepts empty string name (no min constraint)', () => {
    // RenameSchema has no .min(1) on name -- it allows empty strings.
    // The SessionManager.rename() method handles fallback to defaultName.
    const result = RenameSchema.parse({ sessionId: VALID_UUID, name: '' })
    expect(result.name).toBe('')
  })

  it('rejects name exceeding max length of 40', () => {
    const longName = 'a'.repeat(41)
    expect(() => RenameSchema.parse({ sessionId: VALID_UUID, name: longName })).toThrow()
  })

  it('accepts name at exactly max length of 40', () => {
    const maxName = 'a'.repeat(40)
    const result = RenameSchema.parse({ sessionId: VALID_UUID, name: maxName })
    expect(result.name).toBe(maxName)
  })

  it('rejects missing sessionId', () => {
    expect(() => RenameSchema.parse({ name: 'test' })).toThrow()
  })

  it('rejects missing name', () => {
    expect(() => RenameSchema.parse({ sessionId: VALID_UUID })).toThrow()
  })

  it('rejects empty sessionId', () => {
    expect(() => RenameSchema.parse({ sessionId: '', name: 'test' })).toThrow()
  })

  it('rejects non-UUID sessionId', () => {
    expect(() => RenameSchema.parse({ sessionId: 'abc-123', name: 'test' })).toThrow()
  })

  it('rejects non-string name (number)', () => {
    expect(() => RenameSchema.parse({ sessionId: VALID_UUID, name: 42 })).toThrow()
  })

  it('rejects null name', () => {
    expect(() => RenameSchema.parse({ sessionId: VALID_UUID, name: null })).toThrow()
  })

  it('strips unknown properties', () => {
    const result = RenameSchema.parse({ sessionId: VALID_UUID, name: 'Test', extra: true })
    expect(result).not.toHaveProperty('extra')
  })
})

// ---------------------------------------------------------------------------
// SessionIdSchema
// ---------------------------------------------------------------------------
describe('SessionIdSchema', () => {
  it('accepts a valid UUID string', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const result = SessionIdSchema.parse(uuid)
    expect(result).toBe(uuid)
  })

  it('rejects non-UUID strings', () => {
    expect(() => SessionIdSchema.parse('some-session-id')).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => SessionIdSchema.parse('')).toThrow()
  })

  it('rejects non-string input (number)', () => {
    expect(() => SessionIdSchema.parse(123)).toThrow()
  })

  it('rejects non-string input (null)', () => {
    expect(() => SessionIdSchema.parse(null)).toThrow()
  })

  it('rejects non-string input (undefined)', () => {
    expect(() => SessionIdSchema.parse(undefined)).toThrow()
  })

  it('rejects non-string input (boolean)', () => {
    expect(() => SessionIdSchema.parse(true)).toThrow()
  })

  it('rejects non-string input (object)', () => {
    expect(() => SessionIdSchema.parse({})).toThrow()
  })

  it('rejects UUID with extra trailing characters', () => {
    expect(() => SessionIdSchema.parse('550e8400-e29b-41d4-a716-446655440000-extra')).toThrow()
  })
})
