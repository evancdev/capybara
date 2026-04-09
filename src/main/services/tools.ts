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
  'AskUserQuestion'
])

/** Returns true if the named tool is in the auto-approve allowlist. */
export function isToolAutoApproved(toolName: string): boolean {
  return AUTO_APPROVE_TOOLS.has(toolName)
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
