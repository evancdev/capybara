import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the SDK functions history.ts wraps.
// ---------------------------------------------------------------------------
const mockListSessions = vi.fn()
const mockGetSessionMessages = vi.fn()
const mockRenameSession = vi.fn()

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: (...args: unknown[]) => mockListSessions(...args) as unknown,
  getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args) as unknown,
  renameSession: (...args: unknown[]) => mockRenameSession(...args) as unknown
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

const { listConversations, loadConversationMessages, renameConversation } =
  await import('@/main/claude/history')

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------
describe('listConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls SDK listSessions with the project path as dir', async () => {
    mockListSessions.mockResolvedValue([])

    await listConversations('/Users/test/project')

    expect(mockListSessions).toHaveBeenCalledWith({
      dir: '/Users/test/project'
    })
  })

  it('returns an empty array when SDK returns no sessions', async () => {
    mockListSessions.mockResolvedValue([])

    const result = await listConversations('/Users/test/project')
    expect(result).toEqual([])
  })

  it('maps SDKSessionInfo to Session with all expected fields', async () => {
    mockListSessions.mockResolvedValue([
      {
        sessionId: 'conv-1',
        createdAt: 1700000000,
        lastModified: 1700001000,
        summary: 'Refactor auth',
        gitBranch: 'main'
      }
    ])

    const result = await listConversations('/Users/test/project')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 'conv-1',
      status: 'exited',
      exitCode: null,
      createdAt: 1700000000,
      title: 'Refactor auth',
      lastActive: 1700001000,
      role: null,
      animal: null,
      gitRoot: null,
      gitBranch: 'main'
    })
  })

  it('falls back to lastModified when createdAt is missing', async () => {
    mockListSessions.mockResolvedValue([
      {
        sessionId: 'conv-2',
        lastModified: 1700001234,
        summary: 'No create timestamp'
      }
    ])

    const result = await listConversations('/Users/test/project')
    expect(result[0].createdAt).toBe(1700001234)
  })

  it('marks all conversations as status="exited"', async () => {
    mockListSessions.mockResolvedValue([
      { sessionId: 'a', lastModified: 1, summary: 'a' },
      { sessionId: 'b', lastModified: 2, summary: 'b' }
    ])

    const result = await listConversations('/Users/test/project')
    expect(result.every((s) => s.status === 'exited')).toBe(true)
  })

  it('returns [] and logs a warning when listSessions throws an Error', async () => {
    mockListSessions.mockRejectedValue(new Error('ENOENT'))

    const result = await listConversations('/Users/test/project')

    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to list conversations',
      expect.objectContaining({
        projectPath: '/Users/test/project',
        error: 'ENOENT'
      })
    )
  })

  it('returns [] and stringifies non-Error rejections in the warn log', async () => {
    mockListSessions.mockRejectedValue('string-rejection')

    const result = await listConversations('/Users/test/project')

    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to list conversations',
      expect.objectContaining({ error: 'string-rejection' })
    )
  })

  it('does not throw when SDK returns sessions with missing optional fields', async () => {
    mockListSessions.mockResolvedValue([
      {
        sessionId: 'minimal',
        lastModified: 1
      }
    ])

    const result = await listConversations('/Users/test/project')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('minimal')
  })
})

// ---------------------------------------------------------------------------
// loadConversationMessages
// ---------------------------------------------------------------------------
describe('loadConversationMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls SDK getSessionMessages with conversationId and dir', async () => {
    mockGetSessionMessages.mockResolvedValue([])

    await loadConversationMessages('/Users/test/project', 'conv-123', 'sid-1')

    expect(mockGetSessionMessages).toHaveBeenCalledWith('conv-123', {
      dir: '/Users/test/project'
    })
  })

  it('returns [] when SDK returns no messages', async () => {
    mockGetSessionMessages.mockResolvedValue([])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect(result).toEqual([])
  })

  it('translates user messages with string content', async () => {
    mockGetSessionMessages.mockResolvedValue([
      { type: 'user', message: { content: 'hello user' } }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-target'
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'user_message',
      sessionId: 'sid-target',
      text: 'hello user'
    })
  })

  it('drops user messages with non-string content', async () => {
    mockGetSessionMessages.mockResolvedValue([
      { type: 'user', message: { content: { foo: 'bar' } } }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect(result).toEqual([])
  })

  it('drops messages whose .message field is missing', async () => {
    mockGetSessionMessages.mockResolvedValue([{ type: 'user' }])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect(result).toEqual([])
  })

  it('translates assistant messages with text content blocks', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [{ type: 'text', text: 'hi from assistant' }]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'assistant_message',
      sessionId: 'sid-1',
      model: 'claude-opus-4'
    })
    const content = (result[0] as { content: { type: string; text: string }[] })
      .content
    expect(content[0]).toEqual({ type: 'text', text: 'hi from assistant' })
  })

  it('translates assistant messages with thinking blocks', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [{ type: 'thinking', thinking: 'pondering...' }]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (
      result[0] as { content: { type: string; thinking: string }[] }
    ).content
    expect(content[0]).toEqual({ type: 'thinking', thinking: 'pondering...' })
  })

  it('translates assistant messages with tool_use blocks', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: 'Read',
              input: { file: 'index.ts' }
            }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (
      result[0] as {
        content: {
          type: string
          toolUseId: string
          toolName: string
          input: unknown
        }[]
      }
    ).content
    expect(content[0]).toEqual({
      type: 'tool_use',
      toolUseId: 'tu-1',
      toolName: 'Read',
      input: { file: 'index.ts' }
    })
  })

  it('translates assistant messages with tool_result string content', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-1',
              content: 'output text',
              is_error: false
            }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (
      result[0] as {
        content: {
          type: string
          output: string
          isError: boolean
          toolUseId: string
        }[]
      }
    ).content
    expect(content[0]).toEqual({
      type: 'tool_result',
      toolUseId: 'tu-1',
      output: 'output text',
      isError: false
    })
  })

  it('translates tool_result with structured content array (joins .text fields)', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-2',
              content: [
                { type: 'text', text: 'first' },
                { type: 'text', text: 'second' }
              ],
              is_error: false
            }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (result[0] as { content: { output: string }[] }).content
    expect(content[0].output).toBe('first\nsecond')
  })

  it('marks tool_result with isError=true correctly', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-err',
              content: 'failed',
              is_error: true
            }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (result[0] as { content: { isError: boolean }[] }).content
    expect(content[0].isError).toBe(true)
  })

  it('treats missing is_error as false (not undefined)', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            { type: 'tool_result', tool_use_id: 'tu', content: 'x' }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (result[0] as { content: { isError: boolean }[] }).content
    expect(content[0].isError).toBe(false)
  })

  it('treats missing model field on assistant message as "unknown"', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect((result[0] as { model: string }).model).toBe('unknown')
  })

  it('drops assistant messages whose translated content is empty', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: { content: [{ type: 'mystery_block', foo: 'bar' }] }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect(result).toEqual([])
  })

  it('returns [] and logs warn when SDK throws', async () => {
    mockGetSessionMessages.mockRejectedValue(new Error('disk read error'))

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )

    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Could not load conversation history for resume',
      expect.objectContaining({
        conversationId: 'conv-1',
        sessionId: 'sid-1',
        error: 'disk read error'
      })
    )
  })

  it('stringifies non-Error rejections', async () => {
    mockGetSessionMessages.mockRejectedValue('uh oh')

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect(result).toEqual([])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Could not load conversation history for resume',
      expect.objectContaining({ error: 'uh oh' })
    )
  })

  it('drops unknown message.type values silently', async () => {
    mockGetSessionMessages.mockResolvedValue([
      { type: 'system', message: { content: 'something' } }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    expect(result).toEqual([])
  })

  it('handles a multi-turn conversation in order', async () => {
    mockGetSessionMessages.mockResolvedValue([
      { type: 'user', message: { content: 'q1' } },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [{ type: 'text', text: 'a1' }]
        }
      },
      { type: 'user', message: { content: 'q2' } },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [{ type: 'text', text: 'a2' }]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )

    expect(result).toHaveLength(4)
    const kinds = result.map((m) => m.kind)
    expect(kinds).toEqual([
      'user_message',
      'assistant_message',
      'user_message',
      'assistant_message'
    ])
  })

  it('drops tool_use blocks with missing id and name (uses empty string fallback)', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [{ type: 'tool_use', input: {} }]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (
      result[0] as {
        content: { toolUseId: string; toolName: string; input: unknown }[]
      }
    ).content
    expect(content[0].toolUseId).toBe('')
    expect(content[0].toolName).toBe('')
    expect(content[0].input).toEqual({})
  })

  it('drops tool_result whose tool_use_id is missing — uses empty string fallback', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [{ type: 'tool_result', content: 'x' }]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (result[0] as { content: { toolUseId: string }[] }).content
    expect(content[0].toolUseId).toBe('')
  })

  it('handles tool_result with non-string non-array content as empty output', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu',
              content: { something: 'unexpected' }
            }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (result[0] as { content: { output: string }[] }).content
    expect(content[0].output).toBe('')
  })

  it('filters tool_result content array entries with non-string text fields', async () => {
    mockGetSessionMessages.mockResolvedValue([
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu',
              content: [
                { type: 'text', text: 'kept' },
                { type: 'text', text: 42 },
                { type: 'text' }
              ]
            }
          ]
        }
      }
    ])

    const result = await loadConversationMessages(
      '/Users/test/project',
      'conv-1',
      'sid-1'
    )
    const content = (result[0] as { content: { output: string }[] }).content
    expect(content[0].output).toBe('kept')
  })
})

// ---------------------------------------------------------------------------
// renameConversation
// ---------------------------------------------------------------------------
describe('renameConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls SDK renameSession with conversationId, title, and dir option when cwd is provided', async () => {
    mockRenameSession.mockResolvedValue(undefined)

    await renameConversation('conv-1', 'New Title', '/Users/test/project')

    expect(mockRenameSession).toHaveBeenCalledWith('conv-1', 'New Title', {
      dir: '/Users/test/project'
    })
  })

  it('calls SDK renameSession with undefined options when cwd is omitted', async () => {
    mockRenameSession.mockResolvedValue(undefined)

    await renameConversation('conv-1', 'New Title')

    expect(mockRenameSession).toHaveBeenCalledWith(
      'conv-1',
      'New Title',
      undefined
    )
  })

  it('propagates SDK errors to the caller', async () => {
    mockRenameSession.mockRejectedValue(new Error('rename failed'))

    await expect(
      renameConversation('conv-1', 'New', '/Users/test/project')
    ).rejects.toThrow('rename failed')
  })

  it('does not log on success', async () => {
    mockRenameSession.mockResolvedValue(undefined)

    await renameConversation('conv-1', 'New', '/Users/test/project')

    expect(mockLogger.info).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})
