import { describe, it, expect } from 'vitest'
import {
  CreateSessionSchema,
  SessionIdSchema,
  SendMessageSchema,
  GetMessagesSchema,
  ToolApprovalResponseSchema,
  ListConversationsSchema,
  RenameConversationSchema
} from '@/shared/schemas/session'
import { TEST_UUIDS } from '../../fixtures/uuids'

const VALID_UUID = TEST_UUIDS.session

// ---------------------------------------------------------------------------
// CreateSessionSchema
// ---------------------------------------------------------------------------
describe('CreateSessionSchema', () => {
  it('accepts valid input with cwd only', () => {
    const result = CreateSessionSchema.parse({ cwd: '/Users/test/project' })
    expect(result).toEqual({ cwd: '/Users/test/project' })
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

  it('rejects null cwd', () => {
    expect(() => CreateSessionSchema.parse({ cwd: null })).toThrow()
  })

  it('strips unknown properties', () => {
    const result = CreateSessionSchema.parse({ cwd: '/tmp', extra: true })
    expect(result).not.toHaveProperty('extra')
  })

  it('accepts valid resumeConversationId (UUID)', () => {
    const result = CreateSessionSchema.parse({
      cwd: '/tmp',
      resumeConversationId: VALID_UUID
    })
    expect(result.resumeConversationId).toBe(VALID_UUID)
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
// SessionIdSchema
// ---------------------------------------------------------------------------
describe('SessionIdSchema', () => {
  it('accepts a valid UUID string', () => {
    expect(SessionIdSchema.parse(VALID_UUID)).toBe(VALID_UUID)
  })

  it('rejects non-UUID strings', () => {
    expect(() => SessionIdSchema.parse('some-session-id')).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => SessionIdSchema.parse('')).toThrow()
  })

  it.each([
    ['number', 123],
    ['null', null],
    ['undefined', undefined],
    ['boolean', true],
    ['object', {}]
  ])('rejects non-string input (%s)', (_label, value) => {
    expect(() => SessionIdSchema.parse(value)).toThrow()
  })

  it('rejects UUID with extra trailing characters', () => {
    expect(() => SessionIdSchema.parse(`${VALID_UUID}-extra`)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// SendMessageSchema
// ---------------------------------------------------------------------------
describe('SendMessageSchema', () => {
  it('accepts valid input with UUID sessionId and non-empty message', () => {
    const result = SendMessageSchema.parse({
      sessionId: VALID_UUID,
      message: 'Hello world'
    })
    expect(result).toEqual({ sessionId: VALID_UUID, message: 'Hello world' })
  })

  it('rejects missing sessionId', () => {
    expect(() => SendMessageSchema.parse({ message: 'Hello' })).toThrow()
  })

  it('rejects missing message', () => {
    expect(() => SendMessageSchema.parse({ sessionId: VALID_UUID })).toThrow()
  })

  it('rejects empty message string', () => {
    expect(() =>
      SendMessageSchema.parse({ sessionId: VALID_UUID, message: '' })
    ).toThrow()
  })

  it('rejects message exceeding 100000 characters', () => {
    expect(() =>
      SendMessageSchema.parse({
        sessionId: VALID_UUID,
        message: 'x'.repeat(100001)
      })
    ).toThrow()
  })

  it('accepts message at exactly 100000 characters (max boundary)', () => {
    const result = SendMessageSchema.parse({
      sessionId: VALID_UUID,
      message: 'x'.repeat(100000)
    })
    expect(result.message).toHaveLength(100000)
  })

  it('accepts message with 1 character (min boundary)', () => {
    const result = SendMessageSchema.parse({
      sessionId: VALID_UUID,
      message: 'x'
    })
    expect(result.message).toBe('x')
  })

  it('rejects invalid UUID in sessionId', () => {
    expect(() =>
      SendMessageSchema.parse({ sessionId: 'not-a-valid-uuid', message: 'Hello' })
    ).toThrow()
  })

  it('rejects UUID with extra trailing characters', () => {
    expect(() =>
      SendMessageSchema.parse({
        sessionId: `${VALID_UUID}-extra`,
        message: 'Hello'
      })
    ).toThrow()
  })

  it.each([
    ['non-string sessionId', { sessionId: 123, message: 'Hello' }],
    ['null sessionId', { sessionId: null, message: 'Hello' }],
    ['non-string message', { sessionId: VALID_UUID, message: 42 }],
    ['null message', { sessionId: VALID_UUID, message: null }]
  ])('rejects %s', (_label, input) => {
    expect(() => SendMessageSchema.parse(input)).toThrow()
  })

  it('rejects empty object', () => {
    expect(() => SendMessageSchema.parse({})).toThrow()
  })

  it('rejects non-object input', () => {
    expect(() => SendMessageSchema.parse('string')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// GetMessagesSchema
// ---------------------------------------------------------------------------
describe('GetMessagesSchema', () => {
  it('accepts valid UUID sessionId', () => {
    const result = GetMessagesSchema.parse({ sessionId: VALID_UUID })
    expect(result).toEqual({ sessionId: VALID_UUID })
  })

  it('rejects invalid UUID', () => {
    expect(() => GetMessagesSchema.parse({ sessionId: 'not-a-uuid' })).toThrow()
  })

  it('rejects empty string sessionId', () => {
    expect(() => GetMessagesSchema.parse({ sessionId: '' })).toThrow()
  })

  it('rejects missing sessionId', () => {
    expect(() => GetMessagesSchema.parse({})).toThrow()
  })

  it.each([
    ['number', { sessionId: 123 }],
    ['null', { sessionId: null }],
    ['boolean', { sessionId: true }]
  ])('rejects non-string sessionId (%s)', (_label, input) => {
    expect(() => GetMessagesSchema.parse(input)).toThrow()
  })

  it('rejects non-object input', () => {
    expect(() => GetMessagesSchema.parse('string')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ToolApprovalResponseSchema
// ---------------------------------------------------------------------------
describe('ToolApprovalResponseSchema', () => {
  it('accepts approve decision with minimal fields', () => {
    const result = ToolApprovalResponseSchema.parse({
      sessionId: VALID_UUID,
      toolUseId: 'tool-1',
      decision: 'approve'
    })
    expect(result).toMatchObject({
      sessionId: VALID_UUID,
      toolUseId: 'tool-1',
      decision: 'approve'
    })
  })

  it('accepts deny decision', () => {
    const result = ToolApprovalResponseSchema.parse({
      sessionId: VALID_UUID,
      toolUseId: 'tool-2',
      decision: 'deny'
    })
    expect(result.decision).toBe('deny')
  })

  it('rejects invalid decision values', () => {
    expect(() =>
      ToolApprovalResponseSchema.parse({
        sessionId: VALID_UUID,
        toolUseId: 'tool-1',
        decision: 'modify'
      })
    ).toThrow()
    expect(() =>
      ToolApprovalResponseSchema.parse({
        sessionId: VALID_UUID,
        toolUseId: 'tool-1',
        decision: 'maybe'
      })
    ).toThrow()
  })

  it('accepts with message string', () => {
    const result = ToolApprovalResponseSchema.parse({
      sessionId: VALID_UUID,
      toolUseId: 'tool-1',
      decision: 'deny',
      message: 'Too dangerous'
    })
    expect(result.message).toBe('Too dangerous')
  })

  it('accepts with null message', () => {
    const result = ToolApprovalResponseSchema.parse({
      sessionId: VALID_UUID,
      toolUseId: 'tool-1',
      decision: 'approve',
      message: null
    })
    expect(result.message).toBeNull()
  })

  it('accepts without optional message', () => {
    const result = ToolApprovalResponseSchema.parse({
      sessionId: VALID_UUID,
      toolUseId: 'tool-1',
      decision: 'approve'
    })
    expect(result.message).toBeUndefined()
  })

  it('rejects empty toolUseId', () => {
    expect(() =>
      ToolApprovalResponseSchema.parse({
        sessionId: VALID_UUID,
        toolUseId: '',
        decision: 'approve'
      })
    ).toThrow()
  })

  it('rejects invalid UUID in sessionId', () => {
    expect(() =>
      ToolApprovalResponseSchema.parse({
        sessionId: 'bad',
        toolUseId: 'tool-1',
        decision: 'approve'
      })
    ).toThrow()
  })

  it.each([
    ['missing sessionId', { toolUseId: 'tool-1', decision: 'approve' }],
    ['missing toolUseId', { sessionId: VALID_UUID, decision: 'approve' }],
    ['missing decision', { sessionId: VALID_UUID, toolUseId: 'tool-1' }]
  ])('rejects %s', (_label, input) => {
    expect(() => ToolApprovalResponseSchema.parse(input)).toThrow()
  })

  it('rejects message exceeding 10000 characters', () => {
    expect(() =>
      ToolApprovalResponseSchema.parse({
        sessionId: VALID_UUID,
        toolUseId: 'tool-1',
        decision: 'deny',
        message: 'x'.repeat(10001)
      })
    ).toThrow()
  })

  it('accepts message at exactly 10000 characters (max boundary)', () => {
    const result = ToolApprovalResponseSchema.parse({
      sessionId: VALID_UUID,
      toolUseId: 'tool-1',
      decision: 'deny',
      message: 'x'.repeat(10000)
    })
    expect(result.message).toHaveLength(10000)
  })

  it('rejects non-string toolUseId', () => {
    expect(() =>
      ToolApprovalResponseSchema.parse({
        sessionId: VALID_UUID,
        toolUseId: 123,
        decision: 'approve'
      })
    ).toThrow()
  })

  it('rejects empty object', () => {
    expect(() => ToolApprovalResponseSchema.parse({})).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ListConversationsSchema
// ---------------------------------------------------------------------------
describe('ListConversationsSchema', () => {
  it('accepts valid projectPath', () => {
    const result = ListConversationsSchema.parse({
      projectPath: '/Users/test/project'
    })
    expect(result.projectPath).toBe('/Users/test/project')
  })

  it('rejects missing projectPath', () => {
    expect(() => ListConversationsSchema.parse({})).toThrow()
  })

  it('rejects empty projectPath', () => {
    expect(() => ListConversationsSchema.parse({ projectPath: '' })).toThrow()
  })

  it('rejects projectPath exceeding 4096 characters', () => {
    expect(() =>
      ListConversationsSchema.parse({ projectPath: 'x'.repeat(4097) })
    ).toThrow()
  })

  it('rejects non-string projectPath', () => {
    expect(() => ListConversationsSchema.parse({ projectPath: 123 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// RenameConversationSchema
// ---------------------------------------------------------------------------
describe('RenameConversationSchema', () => {
  it('accepts minimal valid input (no cwd)', () => {
    const result = RenameConversationSchema.parse({
      conversationId: VALID_UUID,
      title: 'New title'
    })
    expect(result).toEqual({
      conversationId: VALID_UUID,
      title: 'New title'
    })
  })

  it('accepts input with optional cwd', () => {
    const result = RenameConversationSchema.parse({
      conversationId: VALID_UUID,
      title: 'Refactor auth',
      cwd: '/Users/test/project'
    })
    expect(result.cwd).toBe('/Users/test/project')
  })

  it('rejects non-UUID conversationId', () => {
    expect(() =>
      RenameConversationSchema.parse({
        conversationId: 'not-a-uuid',
        title: 'valid'
      })
    ).toThrow()
  })

  it('rejects empty title', () => {
    expect(() =>
      RenameConversationSchema.parse({
        conversationId: VALID_UUID,
        title: ''
      })
    ).toThrow()
  })

  it('rejects title exceeding 200 characters', () => {
    expect(() =>
      RenameConversationSchema.parse({
        conversationId: VALID_UUID,
        title: 'x'.repeat(201)
      })
    ).toThrow()
  })

  it('accepts title at exactly 200 characters (max boundary)', () => {
    const result = RenameConversationSchema.parse({
      conversationId: VALID_UUID,
      title: 'x'.repeat(200)
    })
    expect(result.title).toHaveLength(200)
  })

  it('accepts title with 1 character (min boundary)', () => {
    const result = RenameConversationSchema.parse({
      conversationId: VALID_UUID,
      title: 'x'
    })
    expect(result.title).toBe('x')
  })

  it('rejects empty cwd when provided', () => {
    expect(() =>
      RenameConversationSchema.parse({
        conversationId: VALID_UUID,
        title: 'valid',
        cwd: ''
      })
    ).toThrow()
  })

  it('rejects cwd exceeding 4096 characters', () => {
    expect(() =>
      RenameConversationSchema.parse({
        conversationId: VALID_UUID,
        title: 'valid',
        cwd: 'x'.repeat(4097)
      })
    ).toThrow()
  })

  it.each([
    ['missing conversationId', { title: 'new' }],
    ['missing title', { conversationId: VALID_UUID }],
    ['empty object', {}]
  ])('rejects %s', (_label, input) => {
    expect(() => RenameConversationSchema.parse(input)).toThrow()
  })
})
