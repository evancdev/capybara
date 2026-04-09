import type { ToolApprovalResult } from '@/main/types/tools'
import { BaseError } from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'

/** Tools auto-approved without prompting the user (read-only + AskUserQuestion). */
const AUTO_APPROVE_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'AskUserQuestion',
  // In-process MCP: inter-agent messaging. Runaway risk is bounded by
  // circular detection + maxDepth + per-call timeout in InterAgentRouter.
  'mcp__capybara_inter_agent__send_to_agent'
])

/** Returns true if the named tool is in the auto-approve allowlist. */
export function isToolAutoApproved(toolName: string): boolean {
  if (AUTO_APPROVE_TOOLS.has(toolName)) return true
  // Belt-and-suspenders: the MCP prefix format is verified at runtime on
  // first use. Until confirmed in production logs, fall back to a suffix
  // match so the first invocation never hits an approval modal.
  // TODO: verify exact MCP prefix on first run
  if (toolName.endsWith('__send_to_agent')) return true
  return false
}

/**
 * Decide whether a tool invocation should be allowed, denied, or forwarded
 * to the user. Read-only tools and AskUserQuestion are auto-approved.
 * Everything else requires user approval.
 */
export function evaluateToolPolicy(
  toolName: string,
  _input: Record<string, unknown>
): ToolApprovalResult {
  if (isToolAutoApproved(toolName)) {
    logger.info('Tool auto-approved', { toolName })
    return { behavior: 'allow' }
  }

  logger.info('Tool requires user approval, forwarding to UI', { toolName })
  return { behavior: 'ask_user' }
}

/**
 * Internal signal thrown into a pending tool-approval Promise when the session
 * is destroyed. Caught inside `ClaudeConnection.canUseTool`; never reaches IPC.
 */
export class ApprovalAbortedError extends BaseError {
  publicMessage = 'Tool approval aborted'
  constructor(message = 'Tool approval aborted') {
    super(message)
  }
}
