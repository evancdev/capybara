import type { SessionService } from '@/main/services/session'
import { IPC } from '@/shared/types/constants'
import {
  CreateSessionSchema,
  ListConversationsSchema,
  RenameConversationSchema,
  SessionIdSchema,
  SendMessageSchema,
  SendInterAgentMessageSchema,
  GetMessagesSchema,
  ToolApprovalResponseSchema
} from '@/shared/schemas/session'
import type { CwdDeps } from '@/main/types/cwd'
import { validateCwd, defaultCwdDeps } from '@/main/lib/cwd'
import { handle } from '@/main/ipc/transport'

/**
 * Registers every session-related IPC channel the renderer can call. Call once at app startup.
 */
export function registerSessionHandlers(
  sessionService: SessionService,
  cwdDeps: CwdDeps = defaultCwdDeps
): void {
  // Session lifecycle
  handle(IPC.SESSION_CREATE, async (input: unknown) => {
    const parsed = CreateSessionSchema.parse(input)
    const cwd = await validateCwd(parsed.cwd, cwdDeps)
    return sessionService.create(cwd, parsed.resumeConversationId)
  })

  handle(IPC.SESSION_DESTROY, (id: unknown) => {
    sessionService.destroy(SessionIdSchema.parse(id))
  })

  handle(IPC.SESSION_LIST, () => {
    return sessionService.list()
  })

  handle(IPC.SESSION_STOP_RESPONSE, (id: unknown) => {
    sessionService.stopResponse(SessionIdSchema.parse(id))
  })

  // Messaging
  handle(IPC.SESSION_SEND_MESSAGE, (input: unknown) => {
    const parsed = SendMessageSchema.parse(input)
    sessionService.write(parsed.sessionId, parsed.message)
  })

  handle(IPC.SESSION_SEND_INTER_AGENT_MESSAGE, (input: unknown) => {
    const parsed = SendInterAgentMessageSchema.parse(input)
    sessionService.sendInterAgentMessage(parsed)
  })

  handle(IPC.SESSION_GET_MESSAGES, (input: unknown) => {
    const parsed = GetMessagesSchema.parse(input)
    return sessionService.getMessages(parsed.sessionId)
  })

  // Tool approval
  handle(IPC.TOOL_APPROVAL_RESPONSE, (input: unknown) => {
    const parsed = ToolApprovalResponseSchema.parse(input)
    sessionService.handleToolApprovalResponse(
      parsed.sessionId,
      parsed.toolUseId,
      parsed.decision,
      parsed.message ?? null
    )
  })

  // Conversation history
  handle(IPC.SESSION_LIST_CONVERSATIONS, async (input: unknown) => {
    const parsed = ListConversationsSchema.parse(input)
    const validatedPath = await validateCwd(parsed.projectPath, cwdDeps)
    return sessionService.listConversations(validatedPath)
  })

  handle(IPC.SESSION_RENAME_CONVERSATION, async (input: unknown) => {
    const parsed = RenameConversationSchema.parse(input)
    const validatedCwd =
      parsed.cwd !== undefined
        ? await validateCwd(parsed.cwd, cwdDeps)
        : undefined
    await sessionService.renameConversation(
      parsed.conversationId,
      parsed.title,
      validatedCwd
    )
  })
}
