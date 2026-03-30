import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import type { Conversation } from '@/shared/types/session'
import { logger } from '@/main/lib/logger'
import { MAX_CONVERSATION_SCAN_LINES } from '@/main/types/constants'

export class ConversationHistoryService {
  async listConversations(projectPath: string): Promise<Conversation[]> {
    const encodedPath = this.encodeProjectPath(projectPath)
    const conversationsDir = path.join(
      os.homedir(),
      '.claude',
      'projects',
      encodedPath
    )

    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(conversationsDir, { withFileTypes: true })
    } catch {
      return []
    }

    const jsonlFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.jsonl')
    )

    const results = await Promise.allSettled(
      jsonlFiles.map((file) =>
        this.parseConversationFile(path.join(conversationsDir, file.name))
      )
    )

    const conversations: Conversation[] = []
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === 'fulfilled' && result.value) {
        conversations.push(result.value)
      } else if (result.status === 'rejected') {
        logger.warn('Failed to parse conversation file', {
          file: jsonlFiles[i].name,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
        })
      }
    }

    conversations.sort((a, b) => b.lastActive - a.lastActive)
    return conversations
  }

  private encodeProjectPath(projectPath: string): string {
    return projectPath.replace(/[\\/]/g, '-')
  }

  private async parseConversationFile(
    filePath: string
  ): Promise<Conversation | null> {
    const stat = await fsp.stat(filePath)
    const lastActive = stat.mtimeMs

    let sessionId: string | null = null
    let title: string | null = null

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

    let lineCount = 0
    for await (const line of rl) {
      if (lineCount >= MAX_CONVERSATION_SCAN_LINES) break
      lineCount++

      if (line.trim().length === 0) continue

      try {
        const record = JSON.parse(line) as Record<string, unknown>

        if (
          typeof record.sessionId === 'string' &&
          record.sessionId.length > 0 &&
          sessionId === null
        ) {
          sessionId = record.sessionId
        }

        if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
          title = record.aiTitle
        }
      } catch {
        // Malformed JSON line — skip it.
      }

      // Stop early if we have both values.
      if (sessionId !== null && title !== null) break
    }

    // Ensure the stream is closed even if we broke out of the loop early.
    stream.destroy()

    if (sessionId === null || sessionId === '') {
      // Fall back to the filename (without extension) as the conversation ID.
      sessionId = path.basename(filePath, '.jsonl')
    }

    return {
      id: sessionId,
      title: title ?? 'Untitled',
      lastActive
    }
  }
}
