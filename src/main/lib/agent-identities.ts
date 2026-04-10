import { writeFile, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { logger } from '@/main/lib/logger'

/** Persisted identity: role + display hash for stable display names across restarts. */
export interface StoredIdentity {
  role: string
  hash: string | null
}

let cache: Map<string, StoredIdentity> | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'agent-identities.json')
}

function ensureLoaded(): Map<string, StoredIdentity> {
  if (cache !== null) return cache
  cache = new Map()
  try {
    const path = filePath()
    if (existsSync(path)) {
      const data: Record<string, unknown> = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') {
          // Backward compat: old format was just a role string
          cache.set(k, { role: v, hash: null })
        } else if (
          typeof v === 'object' &&
          v !== null &&
          'role' in v &&
          typeof (v as Record<string, unknown>).role === 'string'
        ) {
          const obj = v as Record<string, unknown>
          cache.set(k, {
            role: obj.role as string,
            hash: typeof obj.hash === 'string' ? obj.hash : null
          })
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load agent identities', { error: err })
  }
  return cache
}

export function loadAgentIdentity(conversationId: string): StoredIdentity | null {
  return ensureLoaded().get(conversationId) ?? null
}

export function saveAgentIdentity(
  conversationId: string,
  identity: StoredIdentity
): void {
  ensureLoaded().set(conversationId, identity)
  const obj = Object.fromEntries(ensureLoaded())
  writeFile(filePath(), JSON.stringify(obj, null, 2), (err) => {
    if (err) logger.warn('Failed to save agent identities', { error: err })
  })
}
