import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKResultError,
  SDKSystemMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SDKSessionStateChangedMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SessionMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  BetaContentBlock,
  BetaUsage
} from '@anthropic-ai/sdk/resources/beta'
import type {
  CapybaraMessage,
  TokenUsage,
  ContentBlock,
  SessionErrorCode,
  TaskStatus,
  SessionState
} from '@/shared/types/messages'
import type { LiveSessionState } from '@/main/claude/connection'

type SystemSDKMessage = Extract<SDKMessage, { type: 'system' }>
type TaskSDKMessage =
  | SDKTaskStartedMessage
  | SDKTaskProgressMessage
  | SDKTaskNotificationMessage

/** Capability bag passed to the translator from the connection. */
export interface TranslatorContext {
  isToolAutoApproved: (toolName: string) => boolean
}

/**
 * Route an SDK message to the appropriate translator and return the
 * resulting CapybaraMessage array. Unknown message types are dropped.
 *
 * The `state` parameter is mutated: usageSummary, liveMetadata, and
 * conversationId may be updated as a side effect.
 */
export function translateSdkMessage(
  sdkMessage: SDKMessage,
  sessionId: string,
  state: LiveSessionState,
  tools: TranslatorContext
): CapybaraMessage[] {
  switch (sdkMessage.type) {
    case 'assistant':
      return handleAssistantMessage(sessionId, sdkMessage, state, tools)

    case 'stream_event':
      return handleStreamEvent(sessionId, sdkMessage)

    case 'result':
      return handleResultMessage(sessionId, sdkMessage, state)

    case 'system':
      return handleSystemMessage(sessionId, sdkMessage, state)

    case 'tool_progress':
      return handleToolProgress(sessionId, sdkMessage)

    case 'tool_use_summary':
      return handleToolUseSummary(sessionId, sdkMessage)

    default:
      return []
  }
}

function handleAssistantMessage(
  sessionId: string,
  sdkMsg: SDKAssistantMessage,
  state: LiveSessionState,
  tools: TranslatorContext
): CapybaraMessage[] {
  const betaMessage = sdkMsg.message

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive: SDK may send null content
  const contentBlocks = translateContentBlocks(betaMessage.content ?? [])
  const usage = extractUsage(betaMessage.usage)

  state.usageSummary.totalInputTokens += usage.inputTokens
  state.usageSummary.totalOutputTokens += usage.outputTokens
  state.usageSummary.turnCount += 1

  const messages: CapybaraMessage[] = [
    {
      kind: 'assistant_message',
      sessionId,
      content: contentBlocks,
      model: betaMessage.model,
      usage,
      timestamp: Date.now()
    },
    {
      kind: 'usage_message',
      sessionId,
      turnUsage: usage,
      summary: { ...state.usageSummary }
    }
  ]

  for (const block of contentBlocks) {
    if (block.type === 'tool_use' && tools.isToolAutoApproved(block.toolName)) {
      messages.push({
        kind: 'tool_use_request',
        sessionId,
        toolUseId: block.toolUseId,
        toolName: block.toolName,
        input: block.input,
        requiresApproval: false
      })
    }
  }

  return messages
}

function handleStreamEvent(
  sessionId: string,
  sdkMsg: SDKPartialAssistantMessage
): CapybaraMessage[] {
  const event = sdkMsg.event
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/prefer-optional-chain -- defensive: SDK may send malformed events
  if (!event || event.type !== 'content_block_delta') return []

  const { delta } = event
  if (delta.type === 'text_delta') {
    return [{ kind: 'assistant_text_delta', sessionId, text: delta.text }]
  }
  if (delta.type === 'thinking_delta') {
    return [{ kind: 'thinking_delta', sessionId, text: delta.thinking }]
  }

  return []
}

function handleResultMessage(
  sessionId: string,
  sdkMsg: SDKResultMessage,
  state: LiveSessionState
): CapybaraMessage[] {
  const messages: CapybaraMessage[] = []

  // Fallback: only capture conversation ID if init didn't already set it.
  if (state.getConversationId() === null && sdkMsg.session_id.length > 0) {
    state.setConversationId(sdkMsg.session_id)
  }

  state.usageSummary.totalCostUsd = sdkMsg.total_cost_usd

  const usage = extractUsage(sdkMsg.usage)
  messages.push({
    kind: 'usage_message',
    sessionId,
    turnUsage: usage,
    summary: { ...state.usageSummary }
  })

  if (sdkMsg.subtype !== 'success') {
    const code = mapResultErrorCode(sdkMsg.subtype)
    const errorMessage = sdkMsg.errors[0] ?? 'Session ended with an error'
    messages.push({
      kind: 'error_message',
      sessionId,
      code,
      message: errorMessage,
      recoverable: sdkMsg.subtype === 'error_max_turns'
    })
  }

  return messages
}

function handleSystemMessage(
  sessionId: string,
  sdkMsg: SystemSDKMessage,
  state: LiveSessionState
): CapybaraMessage[] {
  switch (sdkMsg.subtype) {
    case 'init':
      return handleSystemInit(sessionId, sdkMsg, state)

    case 'compact_boundary':
      return [
        {
          kind: 'system_message',
          sessionId,
          messageType: 'compact_boundary',
          text: 'Context window compacted'
        }
      ]

    case 'task_started':
    case 'task_progress':
    case 'task_notification':
      return handleTaskUpdate(sessionId, sdkMsg)

    case 'session_state_changed':
      return handleSessionStateChange(sessionId, sdkMsg)

    default:
      return []
  }
}

function handleToolProgress(
  sessionId: string,
  sdkMsg: SDKToolProgressMessage
): CapybaraMessage[] {
  return [
    {
      kind: 'tool_progress',
      sessionId,
      toolUseId: sdkMsg.tool_use_id,
      toolName: sdkMsg.tool_name,
      elapsedSeconds: sdkMsg.elapsed_time_seconds
    }
  ]
}

function handleToolUseSummary(
  sessionId: string,
  sdkMsg: SDKToolUseSummaryMessage
): CapybaraMessage[] {
  return [
    {
      kind: 'tool_use_summary',
      sessionId,
      summary: sdkMsg.summary
    }
  ]
}

function handleSystemInit(
  sessionId: string,
  sdkMsg: SDKSystemMessage,
  state: LiveSessionState
): CapybaraMessage[] {
  const safeText = JSON.stringify({
    model: sdkMsg.model,
    tools: sdkMsg.tools,
    cwd: sdkMsg.cwd,
    claude_code_version: sdkMsg.claude_code_version
  })

  const messages: CapybaraMessage[] = [
    {
      kind: 'system_message',
      sessionId,
      messageType: 'init',
      text: safeText
    }
  ]

  const metadataMessages = updateMetadataFromInit(sessionId, sdkMsg, state)
  messages.push(...metadataMessages)
  return messages
}

function handleTaskUpdate(
  sessionId: string,
  sdkMsg: TaskSDKMessage
): CapybaraMessage[] {
  switch (sdkMsg.subtype) {
    case 'task_started':
    case 'task_progress':
      return [
        {
          kind: 'task_update',
          sessionId,
          taskId: sdkMsg.task_id,
          status: (sdkMsg.subtype === 'task_started'
            ? 'started'
            : 'progress') satisfies TaskStatus,
          summary: undefined,
          description: sdkMsg.description
        }
      ]
    case 'task_notification':
      return [
        {
          kind: 'task_update',
          sessionId,
          taskId: sdkMsg.task_id,
          status: 'completed' satisfies TaskStatus,
          summary: sdkMsg.summary,
          description: undefined
        }
      ]
  }
}

function handleSessionStateChange(
  sessionId: string,
  sdkMsg: SDKSessionStateChangedMessage
): CapybaraMessage[] {
  return [
    {
      kind: 'session_state',
      sessionId,
      state: sdkMsg.state as SessionState
    }
  ]
}

function updateMetadataFromInit(
  sessionId: string,
  sdkMsg: SDKSystemMessage,
  state: LiveSessionState
): CapybaraMessage[] {
  if (sdkMsg.session_id && sdkMsg.session_id.length > 0) {
    state.setConversationId(sdkMsg.session_id)
  }

  state.liveMetadata.model = sdkMsg.model
  state.liveMetadata.claudeCodeVersion = sdkMsg.claude_code_version

  if (sdkMsg.betas) {
    state.liveMetadata.contextWindow = deriveContextWindow(sdkMsg.betas)
  }

  return [
    {
      kind: 'metadata_updated',
      sessionId,
      metadata: { ...state.liveMetadata }
    }
  ]
}

/** Translate an array of SDK content blocks into Capybara ContentBlocks. */
export function translateContentBlocks(
  blocks: BetaContentBlock[]
): ContentBlock[] {
  const result: ContentBlock[] = []
  for (const block of blocks) {
    const translated = translateSingleBlock(block)
    if (translated) {
      result.push(translated)
    }
  }
  return result
}

/** Translate a single SDK content block into a Capybara ContentBlock. */
export function translateSingleBlock(
  block: BetaContentBlock
): ContentBlock | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }

    case 'tool_use':
      return {
        type: 'tool_use',
        toolUseId: block.id,
        toolName: block.name,
        input: block.input as Record<string, unknown>
      }

    case 'thinking':
      return { type: 'thinking', thinking: block.thinking }

    case 'redacted_thinking':
      return { type: 'redacted_thinking' }

    case 'server_tool_use':
      return {
        type: 'server_tool_use',
        toolUseId: block.id,
        toolName: block.name,
        input: block.input
      }

    case 'web_search_tool_result':
      return {
        type: 'web_search_tool_result',
        toolUseId: block.tool_use_id,
        searchQuery: '',
        results: Array.isArray(block.content)
          ? block.content.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: ''
            }))
          : []
      }

    case 'mcp_tool_use':
      return {
        type: 'mcp_tool_use',
        toolUseId: block.id,
        serverName: block.server_name,
        toolName: block.name,
        input: block.input as Record<string, unknown>
      }

    case 'mcp_tool_result': {
      const output =
        typeof block.content === 'string'
          ? block.content
          : block.content.map((c) => c.text).join('\n')
      return {
        type: 'mcp_tool_result',
        toolUseId: block.tool_use_id,
        output,
        isError: block.is_error
      }
    }

    default: {
      const raw = block as { type?: string }
      if (typeof raw.type === 'string') {
        return {
          type: 'unknown',
          rawType: raw.type,
          data: JSON.stringify(block)
        }
      }
      return null
    }
  }
}

/** Extract token usage from a BetaUsage object. */
export function extractUsage(usage: BetaUsage | undefined): TokenUsage {
  if (!usage) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheCreationTokens: null
    }
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? null
  }
}

/** Map an SDK result error subtype to a Capybara SessionErrorCode. */
export function mapResultErrorCode(
  subtype: SDKResultError['subtype']
): SessionErrorCode {
  switch (subtype) {
    case 'error_max_turns':
      return 'context_limit'
    case 'error_max_budget_usd':
      return 'rate_limit'
    case 'error_during_execution':
      return 'tool_error'
    default:
      return 'unknown'
  }
}

/**
 * Translate a SessionMessage from the SDK's getSessionMessages() into
 * CapybaraMessage[]. Handles raw JSONL records with untyped content.
 */
export function translateSessionMessage(
  msg: SessionMessage,
  sessionId: string
): CapybaraMessage[] {
  const message = msg.message as Record<string, unknown> | undefined
  if (!message) return []

  if (msg.type === 'user') {
    const content =
      typeof message.content === 'string' ? message.content : null
    if (content === null) return []
    return [
      {
        kind: 'user_message',
        sessionId,
        text: content,
        timestamp: Date.now()
      }
    ]
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- msg.type is untyped
  if (msg.type === 'assistant') {
    const rawBlocks = (message.content ?? []) as Record<string, unknown>[]
    const contentBlocks = translateRawContentBlocks(rawBlocks)

    if (contentBlocks.length === 0) return []

    const model = typeof message.model === 'string' ? message.model : 'unknown'
    return [
      {
        kind: 'assistant_message',
        sessionId,
        content: contentBlocks,
        model,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: null,
          cacheCreationTokens: null
        },
        timestamp: Date.now()
      }
    ]
  }

  return []
}

function translateRawContentBlocks(
  blocks: Record<string, unknown>[]
): ContentBlock[] {
  const result: ContentBlock[] = []
  for (const block of blocks) {
    const blockType = block.type as string
    if (blockType === 'text' && typeof block.text === 'string') {
      result.push({ type: 'text', text: block.text })
    } else if (
      blockType === 'thinking' &&
      typeof block.thinking === 'string'
    ) {
      result.push({ type: 'thinking', thinking: block.thinking })
    } else if (blockType === 'tool_use') {
      result.push({
        type: 'tool_use',
        toolUseId: typeof block.id === 'string' ? block.id : '',
        toolName: typeof block.name === 'string' ? block.name : '',
        input: (block.input as Record<string, unknown> | undefined) ?? {}
      })
    } else if (blockType === 'tool_result') {
      const content = block.content
      let output = ''
      if (typeof content === 'string') {
        output = content
      } else if (Array.isArray(content)) {
        output = content
          .filter(
            (c: Record<string, unknown>) => typeof c.text === 'string'
          )
          .map((c: Record<string, unknown>) => c.text)
          .join('\n')
      }
      result.push({
        type: 'tool_result',
        toolUseId:
          typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
        output,
        isError: block.is_error === true
      })
    }
  }
  return result
}

/**
 * Derive a human-readable context window string from the active betas array.
 * Falls back to "200k" when no context beta is present.
 */
export function deriveContextWindow(betas: string[]): string {
  for (const beta of betas) {
    if (beta.startsWith('context-1m')) return '1M context'
  }
  return '200k'
}
