import {
  listSessions,
  getSessionMessages,
  renameSession
} from '@anthropic-ai/claude-agent-sdk'
import type { SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import type { Session } from '@/shared/types/session'
import { DEFAULT_PERMISSION_MODE } from '@/shared/types/session'
import type { CapybaraMessage } from '@/shared/types/messages'
import { translateSessionMessage } from '@/main/claude/translator'
import { logger } from '@/main/lib/logger'

/** Lists past Claude conversations in the given project directory. */
export async function listConversations(
  projectPath: string
): Promise<Session[]> {
  try {
    const sessions = await listSessions({ dir: projectPath })
    return sessions.map(toSession)
  } catch (err) {
    logger.warn('Failed to list conversations', {
      projectPath,
      error: err instanceof Error ? err.message : String(err)
    })
    return []
  }
}

/** Reads a stored conversation's messages from disk and translates them. */
export async function loadConversationMessages(
  cwd: string,
  conversationId: string,
  sessionId: string
): Promise<CapybaraMessage[]> {
  try {
    const sdkMessages = await getSessionMessages(conversationId, { dir: cwd })
    return sdkMessages.flatMap((msg) =>
      translateSessionMessage(msg, sessionId)
    )
  } catch (err) {
    logger.warn('Could not load conversation history for resume', {
      conversationId,
      sessionId,
      error: err instanceof Error ? err.message : String(err)
    })
    return []
  }
}

/** Rename a stored conversation on disk. */
export async function renameConversation(
  conversationId: string,
  title: string,
  cwd?: string
): Promise<void> {
  await renameSession(
    conversationId,
    title,
    cwd !== undefined ? { dir: cwd } : undefined
  )
}

function toSession(info: SDKSessionInfo): Session {
  return {
    id: info.sessionId,
    status: 'exited',
    exitCode: null,
    createdAt: info.createdAt ?? info.lastModified,
    permissionMode: DEFAULT_PERMISSION_MODE,
    title: info.summary,
    lastActive: info.lastModified,
    gitBranch: info.gitBranch
  }
}
