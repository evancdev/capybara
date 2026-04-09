import { writeFile, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { logger } from '@/main/lib/logger'

let cache: Map<string, string> | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'agent-identities.json')
}

function ensureLoaded(): Map<string, string> {
  if (cache !== null) return cache
  cache = new Map()
  try {
    const path = filePath()
    if (existsSync(path)) {
      const data: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      for (const [k, v] of Object.entries(data)) {
        if (typeof k === 'string' && typeof v === 'string') {
          cache.set(k, v)
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load agent identities', { error: err })
  }
  return cache
}

export function loadAgentIdentity(conversationId: string): string | null {
  return ensureLoaded().get(conversationId) ?? null
}

export function saveAgentIdentity(conversationId: string, role: string): void {
  ensureLoaded().set(conversationId, role)
  const obj = Object.fromEntries(ensureLoaded())
  writeFile(filePath(), JSON.stringify(obj, null, 2), (err) => {
    if (err) logger.warn('Failed to save agent identities', { error: err })
  })
}
