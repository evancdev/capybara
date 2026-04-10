import { describe, it, expect, vi } from 'vitest'
import {
  translateSdkMessage,
  translateContentBlocks,
  translateSingleBlock,
  extractUsage,
  mapResultErrorCode,
  translateSessionMessage,
  deriveContextWindow
} from '@/main/claude/translator'
import type { LiveSessionState } from '@/main/claude/connection'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(): LiveSessionState {
  let cid: string | null = null
  return {
    usageSummary: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: null,
      turnCount: 0
    },
    liveMetadata: {},
    permissionMode: 'default',
    effortLevel: 'high',
    setConversationId: vi.fn((id: string) => {
      cid = id
    }),
    getConversationId: () => cid
  }
}

const tools = { isToolAutoApproved: () => false }
const toolsAutoApprove = { isToolAutoApproved: () => true }

// ---------------------------------------------------------------------------
// extractUsage
// ---------------------------------------------------------------------------
describe('extractUsage', () => {
  it('returns zero usage when input is undefined', () => {
    expect(extractUsage(undefined)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheCreationTokens: null
    })
  })

  it('extracts input and output tokens', () => {
    const usage = extractUsage({
      input_tokens: 100,
      output_tokens: 50
    } as never)
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
  })

  it('extracts cache_read_input_tokens and cache_creation_input_tokens', () => {
    const usage = extractUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10
    } as never)
    expect(usage.cacheReadTokens).toBe(20)
    expect(usage.cacheCreationTokens).toBe(10)
  })

  it('returns null cache tokens when fields are missing', () => {
    const usage = extractUsage({
      input_tokens: 100,
      output_tokens: 50
    } as never)
    expect(usage.cacheReadTokens).toBeNull()
    expect(usage.cacheCreationTokens).toBeNull()
  })

  it('returns null cache tokens when fields are explicitly null', () => {
    const usage = extractUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null
    } as never)
    expect(usage.cacheReadTokens).toBeNull()
    expect(usage.cacheCreationTokens).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mapResultErrorCode
// ---------------------------------------------------------------------------
describe('mapResultErrorCode', () => {
  it('maps error_max_turns to context_limit', () => {
    expect(mapResultErrorCode('error_max_turns' as never)).toBe('context_limit')
  })

  it('maps error_max_budget_usd to rate_limit', () => {
    expect(mapResultErrorCode('error_max_budget_usd' as never)).toBe(
      'rate_limit'
    )
  })

  it('maps error_during_execution to tool_error', () => {
    expect(mapResultErrorCode('error_during_execution' as never)).toBe(
      'tool_error'
    )
  })

  it('maps unknown subtypes to unknown', () => {
    expect(mapResultErrorCode('error_brand_new' as never)).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// deriveContextWindow
// ---------------------------------------------------------------------------
describe('deriveContextWindow', () => {
  it('returns "1M context" when a context-1m beta is present', () => {
    expect(deriveContextWindow(['context-1m-2025-08-07'])).toBe('1M context')
  })

  it('matches any beta starting with "context-1m"', () => {
    expect(deriveContextWindow(['context-1m-experimental'])).toBe(
      '1M context'
    )
  })

  it('returns "200k" when no context beta is present', () => {
    expect(deriveContextWindow(['other-beta', 'unrelated'])).toBe('200k')
  })

  it('returns "200k" for an empty betas array', () => {
    expect(deriveContextWindow([])).toBe('200k')
  })

  it('matches the first context-1m beta and stops scanning', () => {
    expect(
      deriveContextWindow(['unrelated', 'context-1m-stable', 'noise'])
    ).toBe('1M context')
  })
})

// ---------------------------------------------------------------------------
// translateSingleBlock
// ---------------------------------------------------------------------------
describe('translateSingleBlock', () => {
  it('translates text blocks', () => {
    expect(translateSingleBlock({ type: 'text', text: 'hi' } as never)).toEqual(
      { type: 'text', text: 'hi' }
    )
  })

  it('translates tool_use blocks', () => {
    expect(
      translateSingleBlock({
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: { file: 'a' }
      } as never)
    ).toEqual({
      type: 'tool_use',
      toolUseId: 'tu-1',
      toolName: 'Read',
      input: { file: 'a' }
    })
  })

  it('translates thinking blocks', () => {
    expect(
      translateSingleBlock({ type: 'thinking', thinking: 'pondering' } as never)
    ).toEqual({ type: 'thinking', thinking: 'pondering' })
  })

  it('translates redacted_thinking blocks', () => {
    expect(
      translateSingleBlock({ type: 'redacted_thinking' } as never)
    ).toEqual({ type: 'redacted_thinking' })
  })

  it('translates server_tool_use blocks', () => {
    expect(
      translateSingleBlock({
        type: 'server_tool_use',
        id: 'st-1',
        name: 'web_search',
        input: { q: 'x' }
      } as never)
    ).toEqual({
      type: 'server_tool_use',
      toolUseId: 'st-1',
      toolName: 'web_search',
      input: { q: 'x' }
    })
  })

  it('translates web_search_tool_result blocks with result list', () => {
    const result = translateSingleBlock({
      type: 'web_search_tool_result',
      tool_use_id: 'ws-1',
      content: [
        { title: 'A', url: 'https://a' },
        { title: 'B', url: 'https://b' }
      ]
    } as never)
    expect(result).toEqual({
      type: 'web_search_tool_result',
      toolUseId: 'ws-1',
      searchQuery: '',
      results: [
        { title: 'A', url: 'https://a', snippet: '' },
        { title: 'B', url: 'https://b', snippet: '' }
      ]
    })
  })

  it('translates web_search_tool_result with non-array content as empty results', () => {
    const result = translateSingleBlock({
      type: 'web_search_tool_result',
      tool_use_id: 'ws-1',
      content: { error: 'whoops' }
    } as never) as { results: unknown[] }
    expect(result.results).toEqual([])
  })

  it('translates mcp_tool_use blocks', () => {
    expect(
      translateSingleBlock({
        type: 'mcp_tool_use',
        id: 'mcp-1',
        server_name: 'github',
        name: 'get_pr',
        input: { id: 1 }
      } as never)
    ).toEqual({
      type: 'mcp_tool_use',
      toolUseId: 'mcp-1',
      serverName: 'github',
      toolName: 'get_pr',
      input: { id: 1 }
    })
  })

  it('translates mcp_tool_result with string content', () => {
    expect(
      translateSingleBlock({
        type: 'mcp_tool_result',
        tool_use_id: 'mcp-1',
        content: 'output',
        is_error: false
      } as never)
    ).toEqual({
      type: 'mcp_tool_result',
      toolUseId: 'mcp-1',
      output: 'output',
      isError: false
    })
  })

  it('translates mcp_tool_result with array content (joined .text)', () => {
    expect(
      translateSingleBlock({
        type: 'mcp_tool_result',
        tool_use_id: 'mcp-1',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' }
        ],
        is_error: true
      } as never)
    ).toEqual({
      type: 'mcp_tool_result',
      toolUseId: 'mcp-1',
      output: 'a\nb',
      isError: true
    })
  })

  it('falls through to UnknownBlock for unrecognized types', () => {
    const result = translateSingleBlock({
      type: 'mystery',
      foo: 'bar'
    } as never)
    expect(result).toEqual({
      type: 'unknown',
      rawType: 'mystery',
      data: JSON.stringify({ type: 'mystery', foo: 'bar' })
    })
  })

  it('returns null for blocks without a string type', () => {
    expect(
      translateSingleBlock({ foo: 'bar' } as never)
    ).toBeNull()
  })

  it('returns null for blocks where type is not a string', () => {
    expect(translateSingleBlock({ type: 42 } as never)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// translateContentBlocks
// ---------------------------------------------------------------------------
describe('translateContentBlocks', () => {
  it('returns [] for empty input', () => {
    expect(translateContentBlocks([])).toEqual([])
  })

  it('drops null translations from the result array', () => {
    const blocks = translateContentBlocks([
      { type: 'text', text: 'kept' },
      { foo: 'no type' },
      { type: 'text', text: 'also kept' }
    ] as never)
    expect(blocks).toHaveLength(2)
  })

  it('preserves order of blocks', () => {
    const blocks = translateContentBlocks([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'text', text: 'c' }
    ] as never) as { text: string }[]
    expect(blocks.map((b) => b.text)).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// translateSdkMessage — assistant
// ---------------------------------------------------------------------------
describe('translateSdkMessage / assistant', () => {
  it('emits assistant_message + usage_message on a turn', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'hi' }],
          model: 'claude-opus-4',
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      } as never,
      'sid',
      state,
      tools
    )

    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('assistant_message')
    expect(result[1].kind).toBe('usage_message')
  })

  it('mutates state.usageSummary in place after assistant turn', () => {
    const state = makeState()
    translateSdkMessage(
      {
        type: 'assistant',
        message: {
          content: [],
          model: 'claude-opus-4',
          usage: { input_tokens: 100, output_tokens: 50 }
        }
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.usageSummary.totalInputTokens).toBe(100)
    expect(state.usageSummary.totalOutputTokens).toBe(50)
    expect(state.usageSummary.turnCount).toBe(1)
  })

  it('emits tool_use_request for auto-approved tools only', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'Read', input: {} },
            { type: 'tool_use', id: 't2', name: 'Write', input: {} }
          ],
          model: 'claude-opus-4',
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      } as never,
      'sid',
      state,
      {
        isToolAutoApproved: (name: string) =>
          name === 'Read' || name === 'WebFetch'
      }
    )

    const toolUseRequests = result.filter((m) => m.kind === 'tool_use_request')
    expect(toolUseRequests).toHaveLength(1)
    expect(
      (toolUseRequests[0] as { toolName: string }).toolName
    ).toBe('Read')
  })

  it('marks auto-approved tool_use_requests with requiresApproval=false', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't', name: 'Glob', input: {} }],
          model: 'm',
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      } as never,
      'sid',
      state,
      toolsAutoApprove
    )
    const tu = result.find((m) => m.kind === 'tool_use_request') as {
      requiresApproval: boolean
    }
    expect(tu.requiresApproval).toBe(false)
  })

  it('handles assistant message with null content as empty', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'assistant',
        message: {
          content: null,
          model: 'm',
          usage: { input_tokens: 0, output_tokens: 0 }
        }
      } as never,
      'sid',
      state,
      tools
    )
    expect(
      (result[0] as { content: unknown[] }).content
    ).toEqual([])
  })

  it('emits a fresh copy of summary in usage_message (not a reference)', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'assistant',
        message: {
          content: [],
          model: 'm',
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      } as never,
      'sid',
      state,
      tools
    )
    const summary = (result[1] as { summary: unknown }).summary
    expect(summary).not.toBe(state.usageSummary)
    expect(summary).toEqual(state.usageSummary)
  })
})

// ---------------------------------------------------------------------------
// translateSdkMessage — stream_event
// ---------------------------------------------------------------------------
describe('translateSdkMessage / stream_event', () => {
  it('emits assistant_text_delta for text_delta', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'streaming text' }
        }
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([
      { kind: 'assistant_text_delta', sessionId: 'sid', text: 'streaming text' }
    ])
  })

  it('emits thinking_delta for thinking_delta', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'pondering' }
        }
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([
      { kind: 'thinking_delta', sessionId: 'sid', text: 'pondering' }
    ])
  })

  it('drops stream_event with non-content_block_delta event type', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'stream_event',
        event: { type: 'message_start' }
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([])
  })

  it('drops stream_event with missing event field', () => {
    const state = makeState()
    const result = translateSdkMessage(
      { type: 'stream_event' } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([])
  })

  it('drops stream_event with delta type that is neither text nor thinking', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{' }
        }
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// translateSdkMessage — result
// ---------------------------------------------------------------------------
describe('translateSdkMessage / result', () => {
  it('emits a usage_message with cost from total_cost_usd', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        session_id: 'cap-id',
        total_cost_usd: 0.05,
        usage: { input_tokens: 10, output_tokens: 5 }
      } as never,
      'sid',
      state,
      tools
    )
    const usage = result.find((m) => m.kind === 'usage_message') as {
      summary: { totalCostUsd: number }
    }
    expect(usage.summary.totalCostUsd).toBe(0.05)
  })

  it('captures conversation ID from result.session_id when not yet set', () => {
    const state = makeState()
    translateSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        session_id: 'new-id',
        total_cost_usd: 0,
        usage: {}
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.setConversationId).toHaveBeenCalledWith('new-id')
  })

  it('does NOT call setConversationId when already set', () => {
    const state = makeState()
    state.setConversationId('existing-id')
    vi.mocked(state.setConversationId).mockClear()

    translateSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        session_id: 'newer-id',
        total_cost_usd: 0,
        usage: {}
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.setConversationId).not.toHaveBeenCalled()
  })

  it('does NOT call setConversationId when result.session_id is empty string', () => {
    const state = makeState()
    translateSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        session_id: '',
        total_cost_usd: 0,
        usage: {}
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.setConversationId).not.toHaveBeenCalled()
  })

  it('emits an error_message when subtype is not success', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'result',
        subtype: 'error_max_turns',
        session_id: '',
        total_cost_usd: 0,
        usage: {},
        errors: ['Too many turns']
      } as never,
      'sid',
      state,
      tools
    )
    const err = result.find((m) => m.kind === 'error_message') as {
      message: string
      code: string
      recoverable: boolean
    }
    expect(err.message).toBe('Too many turns')
    expect(err.code).toBe('context_limit')
    expect(err.recoverable).toBe(true)
  })

  it('marks error_during_execution as not recoverable', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'result',
        subtype: 'error_during_execution',
        session_id: '',
        total_cost_usd: 0,
        usage: {},
        errors: ['boom']
      } as never,
      'sid',
      state,
      tools
    )
    const err = result.find((m) => m.kind === 'error_message') as {
      recoverable: boolean
    }
    expect(err.recoverable).toBe(false)
  })

  it('uses default message when errors array is empty', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'result',
        subtype: 'error_max_turns',
        session_id: '',
        total_cost_usd: 0,
        usage: {},
        errors: []
      } as never,
      'sid',
      state,
      tools
    )
    const err = result.find((m) => m.kind === 'error_message') as {
      message: string
    }
    expect(err.message).toBe('Session ended with an error')
  })
})

// ---------------------------------------------------------------------------
// translateSdkMessage — system
// ---------------------------------------------------------------------------
describe('translateSdkMessage / system', () => {
  it('emits system_message + metadata_updated for init', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'cap-id',
        model: 'claude-opus-4',
        tools: ['Read'],
        cwd: '/tmp',
        claude_code_version: '2.0.0',
        betas: ['context-1m-2025-08-07']
      } as never,
      'sid',
      state,
      tools
    )
    const sys = result.find((m) => m.kind === 'system_message') as {
      messageType: string
    }
    const meta = result.find((m) => m.kind === 'metadata_updated') as {
      metadata: { model: string; contextWindow: string; claudeCodeVersion: string }
    }
    expect(sys.messageType).toBe('init')
    expect(meta.metadata.model).toBe('claude-opus-4')
    expect(meta.metadata.contextWindow).toBe('1M context')
    expect(meta.metadata.claudeCodeVersion).toBe('2.0.0')
  })

  it('strips api keys from init message text — only safe fields appear', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sid',
        model: 'm',
        tools: [],
        cwd: '/',
        claude_code_version: '1',
        apiKeySource: 'leaked',
        auth: { token: 'never expose' }
      } as never,
      'sid',
      state,
      tools
    )
    const sys = result.find((m) => m.kind === 'system_message') as {
      text: string
    }
    expect(sys.text).not.toContain('apiKeySource')
    expect(sys.text).not.toContain('never expose')
    expect(sys.text).toContain('m')
  })

  it('emits system_message for compact_boundary subtype', () => {
    const state = makeState()
    const result = translateSdkMessage(
      { type: 'system', subtype: 'compact_boundary' } as never,
      'sid',
      state,
      tools
    )
    expect(result).toHaveLength(1)
    expect((result[0] as { messageType: string }).messageType).toBe(
      'compact_boundary'
    )
    expect((result[0] as { text: string }).text).toBe('Context window compacted')
  })

  it('emits task_update for task_started', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'tk-1',
        description: 'Doing the thing'
      } as never,
      'sid',
      state,
      tools
    )
    const task = result[0] as { taskId: string; status: string }
    expect(task.taskId).toBe('tk-1')
    expect(task.status).toBe('started')
  })

  it('emits task_update for task_progress', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'tk-1',
        description: '50%'
      } as never,
      'sid',
      state,
      tools
    )
    expect((result[0] as { status: string }).status).toBe('progress')
  })

  it('emits task_update with completed status for task_notification', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'tk-1',
        summary: 'all done'
      } as never,
      'sid',
      state,
      tools
    )
    const task = result[0] as { status: string; summary: string }
    expect(task.status).toBe('completed')
    expect(task.summary).toBe('all done')
  })

  it('emits session_state for session_state_changed', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'session_state_changed',
        state: 'idle'
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([
      { kind: 'session_state', sessionId: 'sid', state: 'idle' }
    ])
  })

  it('returns [] for unknown system subtypes', () => {
    const state = makeState()
    const result = translateSdkMessage(
      { type: 'system', subtype: 'unknown_subtype' } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([])
  })

  it('captures session_id from init when present', () => {
    const state = makeState()
    translateSdkMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'init-cid',
        model: 'm',
        tools: [],
        cwd: '/',
        claude_code_version: '1'
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.setConversationId).toHaveBeenCalledWith('init-cid')
  })

  it('does NOT capture session_id from init when empty', () => {
    const state = makeState()
    translateSdkMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: '',
        model: 'm',
        tools: [],
        cwd: '/',
        claude_code_version: '1'
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.setConversationId).not.toHaveBeenCalled()
  })

  it('skips contextWindow assignment when betas field is missing', () => {
    const state = makeState()
    translateSdkMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'cid',
        model: 'm',
        tools: [],
        cwd: '/',
        claude_code_version: '1'
      } as never,
      'sid',
      state,
      tools
    )
    expect(state.liveMetadata.contextWindow).toBeUndefined()
  })

  it('emits metadata_updated with permissionMode when status has permissionMode', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'status',
        permissionMode: 'plan'
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe('metadata_updated')
    const meta = result[0] as {
      metadata: { permissionMode: string }
    }
    expect(meta.metadata.permissionMode).toBe('plan')
  })

  it('returns [] when status message has no permissionMode', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'system',
        subtype: 'status'
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// translateSdkMessage — tool_progress and tool_use_summary
// ---------------------------------------------------------------------------
describe('translateSdkMessage / tool_progress', () => {
  it('translates tool_progress', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'tool_progress',
        tool_use_id: 'tu',
        tool_name: 'Read',
        elapsed_time_seconds: 7
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([
      {
        kind: 'tool_progress',
        sessionId: 'sid',
        toolUseId: 'tu',
        toolName: 'Read',
        elapsedSeconds: 7
      }
    ])
  })
})

describe('translateSdkMessage / tool_use_summary', () => {
  it('translates tool_use_summary with summary text', () => {
    const state = makeState()
    const result = translateSdkMessage(
      {
        type: 'tool_use_summary',
        summary: 'Read 100 lines'
      } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([
      { kind: 'tool_use_summary', sessionId: 'sid', summary: 'Read 100 lines' }
    ])
  })
})

describe('translateSdkMessage / unknown', () => {
  it('returns [] for an unknown top-level type', () => {
    const state = makeState()
    const result = translateSdkMessage(
      { type: 'something_brand_new' } as never,
      'sid',
      state,
      tools
    )
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// translateSessionMessage — for resume / loadMessages flow
// ---------------------------------------------------------------------------
describe('translateSessionMessage', () => {
  it('drops messages whose .message field is undefined', () => {
    const result = translateSessionMessage({} as never, 'sid')
    expect(result).toEqual([])
  })

  it('translates user message with string content', () => {
    const result = translateSessionMessage(
      { type: 'user', message: { content: 'hello' } } as never,
      'sid'
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'user_message',
      sessionId: 'sid',
      text: 'hello'
    })
  })

  it('drops user message whose content is not a string', () => {
    const result = translateSessionMessage(
      { type: 'user', message: { content: { obj: true } } } as never,
      'sid'
    )
    expect(result).toEqual([])
  })

  it('translates assistant message with text block', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'text', text: 'hi' }]
        }
      } as never,
      'sid'
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'assistant_message',
      sessionId: 'sid',
      model: 'opus'
    })
  })

  it('translates assistant message with tool_use block', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            {
              type: 'tool_use',
              id: 'tu',
              name: 'Read',
              input: { file: 'a' }
            }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: unknown[] }).content
    expect(content[0]).toMatchObject({
      type: 'tool_use',
      toolUseId: 'tu',
      toolName: 'Read',
      input: { file: 'a' }
    })
  })

  it('translates assistant message with thinking block', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'thinking', thinking: 'pondering' }]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { thinking: string }[] }).content
    expect(content[0].thinking).toBe('pondering')
  })

  it('translates assistant message with tool_result string content', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu',
              content: 'output',
              is_error: false
            }
          ]
        }
      } as never,
      'sid'
    )
    const content = (
      result[0] as { content: { output: string; isError: boolean }[] }
    ).content
    expect(content[0].output).toBe('output')
    expect(content[0].isError).toBe(false)
  })

  it('translates tool_result with array content joining text fields', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu',
              content: [
                { type: 'text', text: 'one' },
                { type: 'text', text: 'two' }
              ]
            }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { output: string }[] }).content
    expect(content[0].output).toBe('one\ntwo')
  })

  it('treats missing tool_result is_error as false', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            { type: 'tool_result', tool_use_id: 'tu', content: 'x' }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { isError: boolean }[] }).content
    expect(content[0].isError).toBe(false)
  })

  it('drops assistant message with no translatable blocks', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'unknown_block_type' }]
        }
      } as never,
      'sid'
    )
    expect(result).toEqual([])
  })

  it('drops messages with non-user non-assistant types', () => {
    const result = translateSessionMessage(
      { type: 'system', message: { content: 'sys' } } as never,
      'sid'
    )
    expect(result).toEqual([])
  })

  it('uses model="unknown" when assistant message has no model field', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] }
      } as never,
      'sid'
    )
    expect((result[0] as { model: string }).model).toBe('unknown')
  })

  it('uses model="unknown" when assistant model is not a string', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: { model: 42, content: [{ type: 'text', text: 'hi' }] }
      } as never,
      'sid'
    )
    expect((result[0] as { model: string }).model).toBe('unknown')
  })

  it('uses empty string for tool_use id and name when missing', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'tool_use', input: {} }]
        }
      } as never,
      'sid'
    )
    const content = (
      result[0] as { content: { toolUseId: string; toolName: string }[] }
    ).content
    expect(content[0].toolUseId).toBe('')
    expect(content[0].toolName).toBe('')
  })

  it('uses empty object for tool_use input when missing', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [{ type: 'tool_use', id: 't', name: 'n' }]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { input: unknown }[] }).content
    expect(content[0].input).toEqual({})
  })

  it('handles tool_result with non-string non-array content as empty output', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            { type: 'tool_result', tool_use_id: 'tu', content: { foo: 1 } }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { output: string }[] }).content
    expect(content[0].output).toBe('')
  })

  it('marks tool_result is_error correctly when explicitly true', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu',
              content: 'x',
              is_error: true
            }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { isError: boolean }[] }).content
    expect(content[0].isError).toBe(true)
  })

  it('drops thinking blocks where thinking field is not a string', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            { type: 'thinking', thinking: 42 },
            { type: 'text', text: 'kept' }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { type: string }[] }).content
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe('text')
  })

  it('drops text blocks with non-string text', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: {
          model: 'opus',
          content: [
            { type: 'text', text: 42 },
            { type: 'text', text: 'kept' }
          ]
        }
      } as never,
      'sid'
    )
    const content = (result[0] as { content: { type: string }[] }).content
    expect(content).toHaveLength(1)
  })

  it('treats missing content field as empty blocks array', () => {
    // This hits the (message.content ?? []) fallback branch.
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: { model: 'opus' }
      } as never,
      'sid'
    )
    expect(result).toEqual([])
  })

  it('treats null content field as empty blocks array', () => {
    const result = translateSessionMessage(
      {
        type: 'assistant',
        message: { model: 'opus', content: null }
      } as never,
      'sid'
    )
    expect(result).toEqual([])
  })
})
