import { z } from 'zod'

export const CreateSessionSchema = z.object({
  cwd: z.string().min(1),
  name: z.string().min(1).max(40).optional(),
  resumeConversationId: z.uuid().optional()
})

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>

export const ResizeSchema = z.object({
  sessionId: z.uuid(),
  cols: z.int().min(1).max(500),
  rows: z.int().min(1).max(200)
})

export type ResizeInput = z.infer<typeof ResizeSchema>

export const SessionIdSchema = z.uuid()

export const RenameSchema = z.object({
  sessionId: z.uuid(),
  name: z.string().max(40)
})

export type RenameInput = z.infer<typeof RenameSchema>
