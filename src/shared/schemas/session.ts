import { z } from 'zod'

// -- Identity ----------------------------------------------------------------

export const SessionIdSchema = z.uuid()

// -- Session lifecycle -------------------------------------------------------

export const CreateSessionSchema = z.object({
  cwd: z.string().min(1).max(4096),
  resumeConversationId: z.uuid().optional()
})

export type CreateSessionInput = z.input<typeof CreateSessionSchema>

// -- Conversations -----------------------------------------------------------

export const ListConversationsSchema = z.object({
  projectPath: z.string().min(1).max(4096)
})

export type ListConversationsInput = z.input<typeof ListConversationsSchema>

export const RenameConversationSchema = z.object({
  conversationId: z.uuid(),
  title: z.string().min(1).max(200),
  cwd: z.string().min(1).max(4096).optional()
})

export type RenameConversationInput = z.input<typeof RenameConversationSchema>

// -- Messaging ---------------------------------------------------------------

export const SendMessageSchema = z.object({
  sessionId: z.uuid(),
  message: z.string().min(1).max(100000)
})

export type SendMessageInput = z.infer<typeof SendMessageSchema>

export const GetMessagesSchema = z.object({
  sessionId: z.uuid()
})

export type GetMessagesInput = z.infer<typeof GetMessagesSchema>

// -- Inter-agent messaging ---------------------------------------------------

export const SendInterAgentMessageSchema = z.object({
  fromSessionId: z.uuid(),
  toSessionId: z.uuid(),
  content: z.string().min(1).max(100000)
})

export type SendInterAgentMessageInput = z.infer<
  typeof SendInterAgentMessageSchema
>

// -- Tool approval -----------------------------------------------------------

export const ToolApprovalResponseSchema = z.object({
  sessionId: z.uuid(),
  toolUseId: z.string().min(1),
  decision: z.enum(['approve', 'deny']),
  message: z.string().max(10000).nullable().optional()
})

export type ToolApprovalResponseInput = z.infer<
  typeof ToolApprovalResponseSchema
>
