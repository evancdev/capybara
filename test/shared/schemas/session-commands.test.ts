import { describe, it, expect } from 'vitest'
import {
  SetPermissionModeSchema,
  RunCommandSchema,
  PermissionModeSchema
} from '@/shared/schemas/session'
import { TEST_UUIDS } from '../../fixtures/uuids'

const VALID_UUID = TEST_UUIDS.session

// ---------------------------------------------------------------------------
// PermissionModeSchema
// ---------------------------------------------------------------------------
describe('PermissionModeSchema', () => {
  it.each([
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
    'dontAsk'
  ] as const)('accepts valid mode "%s"', (mode) => {
    expect(PermissionModeSchema.parse(mode)).toBe(mode)
  })

  it('rejects an empty string', () => {
    expect(() => PermissionModeSchema.parse('')).toThrow()
  })

  it('rejects an unknown mode string', () => {
    expect(() => PermissionModeSchema.parse('turbo')).toThrow()
  })

  it('rejects a number', () => {
    expect(() => PermissionModeSchema.parse(42)).toThrow()
  })

  it('rejects null', () => {
    expect(() => PermissionModeSchema.parse(null)).toThrow()
  })

  it('is case-sensitive (rejects "Default")', () => {
    expect(() => PermissionModeSchema.parse('Default')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// SetPermissionModeSchema
// ---------------------------------------------------------------------------
describe('SetPermissionModeSchema', () => {
  it('accepts valid sessionId + mode', () => {
    const result = SetPermissionModeSchema.parse({
      sessionId: VALID_UUID,
      mode: 'plan'
    })
    expect(result).toEqual({ sessionId: VALID_UUID, mode: 'plan' })
  })

  it('rejects missing sessionId', () => {
    expect(() =>
      SetPermissionModeSchema.parse({ mode: 'plan' })
    ).toThrow()
  })

  it('rejects missing mode', () => {
    expect(() =>
      SetPermissionModeSchema.parse({ sessionId: VALID_UUID })
    ).toThrow()
  })

  it('rejects non-uuid sessionId', () => {
    expect(() =>
      SetPermissionModeSchema.parse({ sessionId: 'bad', mode: 'plan' })
    ).toThrow()
  })

  it('rejects an invalid mode', () => {
    expect(() =>
      SetPermissionModeSchema.parse({
        sessionId: VALID_UUID,
        mode: 'invalid'
      })
    ).toThrow()
  })

  it('rejects an empty object', () => {
    expect(() => SetPermissionModeSchema.parse({})).toThrow()
  })
})

// ---------------------------------------------------------------------------
// RunCommandSchema
// ---------------------------------------------------------------------------
describe('RunCommandSchema', () => {
  it('accepts valid input', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'compact',
      args: []
    })
    expect(result).toEqual({
      sessionId: VALID_UUID,
      command: 'compact',
      args: []
    })
  })

  it('accepts command with args', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'model',
      args: ['claude-opus-4-6']
    })
    expect(result.args).toEqual(['claude-opus-4-6'])
  })

  it('accepts dashes in command name', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'my-command',
      args: []
    })
    expect(result.command).toBe('my-command')
  })

  it('accepts digits in command name', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'cmd2',
      args: []
    })
    expect(result.command).toBe('cmd2')
  })

  it('rejects uppercase in command name', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'Compact',
        args: []
      })
    ).toThrow()
  })

  it('rejects special characters in command name', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'co!mpact',
        args: []
      })
    ).toThrow()
  })

  it('rejects spaces in command name', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'my command',
        args: []
      })
    ).toThrow()
  })

  it('rejects command name exceeding 64 characters', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'a'.repeat(65),
        args: []
      })
    ).toThrow()
  })

  it('accepts command name at exactly 64 characters', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'a'.repeat(64),
      args: []
    })
    expect(result.command).toHaveLength(64)
  })

  it('rejects empty command name', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: '',
        args: []
      })
    ).toThrow()
  })

  it('rejects args array exceeding 32 items', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'cmd',
        args: Array.from({ length: 33 }, (_, i) => `arg${i}`)
      })
    ).toThrow()
  })

  it('accepts args array at exactly 32 items', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'cmd',
      args: Array.from({ length: 32 }, (_, i) => `arg${i}`)
    })
    expect(result.args).toHaveLength(32)
  })

  it('rejects a single arg exceeding 1000 characters', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'cmd',
        args: ['x'.repeat(1001)]
      })
    ).toThrow()
  })

  it('accepts a single arg at exactly 1000 characters', () => {
    const result = RunCommandSchema.parse({
      sessionId: VALID_UUID,
      command: 'cmd',
      args: ['x'.repeat(1000)]
    })
    expect(result.args[0]).toHaveLength(1000)
  })

  it('rejects non-uuid sessionId', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: 'not-a-uuid',
        command: 'compact',
        args: []
      })
    ).toThrow()
  })

  it('rejects missing args', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'compact'
      })
    ).toThrow()
  })

  it('rejects non-array args', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'compact',
        args: 'not-an-array'
      })
    ).toThrow()
  })

  it('rejects non-string items in args array', () => {
    expect(() =>
      RunCommandSchema.parse({
        sessionId: VALID_UUID,
        command: 'compact',
        args: [123]
      })
    ).toThrow()
  })
})
