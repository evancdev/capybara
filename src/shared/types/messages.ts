// ---------------------------------------------------------------------------
// Capybara Message Types
// These are Capybara's own message types. The SessionManager adapter
// translates SDK-specific types into these. No SDK types leak through.
// ---------------------------------------------------------------------------

// -- Primitives --------------------------------------------------------------

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  output: string
  isError: boolean
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking'
}

export interface ServerToolUseBlock {
  type: 'server_tool_use'
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}

export interface WebSearchResultBlock {
  type: 'web_search_tool_result'
  toolUseId: string
  searchQuery: string
  results: { title: string; url: string; snippet: string }[]
}

export interface McpToolUseBlock {
  type: 'mcp_tool_use'
  toolUseId: string
  serverName: string
  toolName: string
  input: Record<string, unknown>
}

export interface McpToolResultBlock {
  type: 'mcp_tool_result'
  toolUseId: string
  output: string
  isError: boolean
}

export interface UnknownBlock {
  type: 'unknown'
  rawType: string
  data: string
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ServerToolUseBlock
  | WebSearchResultBlock
  | McpToolUseBlock
  | McpToolResultBlock
  | UnknownBlock

// -- Token Usage -------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

export interface SessionUsageSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number | null
  turnCount: number
}

// -- CapybaraMessage (discriminated union, key: `kind`) ----------------------

export interface AssistantTextDelta {
  kind: 'assistant_text_delta'
  sessionId: string
  text: string
}

export interface ThinkingDelta {
  kind: 'thinking_delta'
  sessionId: string
  text: string
}

export interface AssistantMessage {
  kind: 'assistant_message'
  sessionId: string
  content: ContentBlock[]
  model: string
  usage: TokenUsage
  timestamp: number
}

export interface ToolUseRequest {
  kind: 'tool_use_request'
  sessionId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  requiresApproval: boolean
  title?: string
  description?: string
  reason?: string
}

export interface ToolResult {
  kind: 'tool_result'
  sessionId: string
  toolUseId: string
  output: string
  isError: boolean
}

export type SystemMessageType = 'init' | 'compact_boundary'

export interface SystemMessage {
  kind: 'system_message'
  sessionId: string
  messageType: SystemMessageType
  text: string
}

export type SessionErrorCode =
  | 'context_limit'
  | 'rate_limit'
  | 'tool_error'
  | 'unknown'

export interface ErrorMessage {
  kind: 'error_message'
  sessionId: string
  code: SessionErrorCode
  message: string
  recoverable: boolean
}

export interface UsageMessage {
  kind: 'usage_message'
  sessionId: string
  turnUsage: TokenUsage
  summary: SessionUsageSummary
}

export interface InterAgentMessage {
  kind: 'inter_agent_message'
  sessionId: string
  fromSessionId: string
  /** Sender display name (e.g. "product-manager the Otter"), or null if sender never registered. */
  fromDisplayName: string | null
  content: string
  timestamp: number
}

export interface UserMessage {
  kind: 'user_message'
  sessionId: string
  text: string
  timestamp: number
}

export interface MetadataUpdated {
  kind: 'metadata_updated'
  sessionId: string
  metadata: {
    claudeCodeVersion?: string
    model?: string
    contextWindow?: string
    plan?: string
  }
}

export interface ToolProgress {
  kind: 'tool_progress'
  sessionId: string
  toolUseId: string
  toolName: string
  elapsedSeconds: number
}

export type TaskStatus = 'started' | 'progress' | 'completed'

export interface TaskUpdate {
  kind: 'task_update'
  sessionId: string
  taskId: string
  status: TaskStatus
  summary?: string
  description?: string
}

export type SessionState = 'idle' | 'running' | 'requires_action'

export interface SessionStateChange {
  kind: 'session_state'
  sessionId: string
  state: SessionState
}

export interface ToolUseSummary {
  kind: 'tool_use_summary'
  sessionId: string
  summary: string
}

export type CapybaraMessage =
  | AssistantTextDelta
  | ThinkingDelta
  | AssistantMessage
  | ToolUseRequest
  | ToolResult
  | SystemMessage
  | ErrorMessage
  | UsageMessage
  | InterAgentMessage
  | UserMessage
  | MetadataUpdated
  | ToolProgress
  | TaskUpdate
  | SessionStateChange
  | ToolUseSummary

// -- Tool Approval -----------------------------------------------------------

export interface ToolApprovalRequest {
  sessionId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  timeoutMs?: number
  title?: string
  description?: string
  reason?: string
}

export type ToolApprovalDecision = 'approve' | 'deny'

export interface ToolApprovalResponse {
  sessionId: string
  toolUseId: string
  decision: ToolApprovalDecision
  message: string | null
}
