import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionManager } from '@/main/services/session-manager'
import type { ConversationHistoryService } from '@/main/services/conversation-history'
import { IPC } from '@/shared/types/constants'
import {
  CreateSessionSchema,
  ResizeSchema,
  SessionIdSchema,
  RenameSchema
} from '@/shared/schemas/session'
import { ProjectPathSchema } from '@/main/schemas/session'
import type { ValidateSender, SendToRenderer } from '@/main/types/ipc'
import { handle } from '@/main/controllers/ipc/safe-handler'
import { CwdValidationError } from '@/main/lib/errors'

async function validateCwd(directory: string): Promise<string> {
  const resolved = path.resolve(directory)
  const home = os.homedir()
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new CwdValidationError('Invalid directory')
  }
  try {
    const stat = await fsp.stat(resolved)
    if (!stat.isDirectory()) {
      throw new CwdValidationError('Invalid directory')
    }
  } catch (err) {
    if (err instanceof CwdValidationError) throw err
    throw new CwdValidationError('Invalid directory')
  }
  return resolved
}

export function registerSessionHandlers(
  sessionManager: SessionManager,
  conversationHistoryService: ConversationHistoryService,
  validateSender: ValidateSender,
  sendToRenderer: SendToRenderer
): void {
  handle(IPC.SESSION_CREATE, async (event, input: unknown) => {
    validateSender(event)
    const parsed = CreateSessionSchema.parse(input)
    const cwd = await validateCwd(parsed.cwd)
    return sessionManager.create(
      { ...parsed, cwd },
      (id, data) => {
        sendToRenderer(IPC.TERMINAL_OUTPUT, id, data)
      },
      (id, exitCode) => {
        sendToRenderer(IPC.SESSION_EXITED, id, exitCode)
      }
    )
  })

  handle(IPC.SESSION_DESTROY, (event, id: unknown) => {
    validateSender(event)
    sessionManager.destroy(SessionIdSchema.parse(id))
  })

  handle(IPC.SESSION_RENAME, (event, id: unknown, name: unknown) => {
    validateSender(event)
    const parsed = RenameSchema.parse({ sessionId: id, name })
    return sessionManager.rename(parsed.sessionId, parsed.name)
  })

  handle(IPC.SESSION_LIST, (event) => {
    validateSender(event)
    return sessionManager.list()
  })

  handle(IPC.SESSION_RESIZE, (event, input: unknown) => {
    validateSender(event)
    const parsed = ResizeSchema.parse(input)
    sessionManager.resize(parsed.sessionId, parsed.cols, parsed.rows)
  })

  handle(IPC.SESSION_REPLAY, (event, id: unknown) => {
    validateSender(event)
    return sessionManager.snapshotAndClearBuffer(SessionIdSchema.parse(id))
  })

  handle(IPC.SESSION_GET_HISTORY, (event, id: unknown) => {
    validateSender(event)
    return sessionManager.getBuffer(SessionIdSchema.parse(id))
  })

  handle(
    IPC.SESSION_LIST_CONVERSATIONS,
    async (event, projectPath: unknown) => {
      validateSender(event)
      const parsed = ProjectPathSchema.parse(projectPath)
      const validatedPath = await validateCwd(parsed)
      return conversationHistoryService.listConversations(validatedPath)
    }
  )
}
