import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock logger
vi.mock('@/main/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const { ConversationHistoryService } = await import(
  '@/main/services/conversation-history'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createService(): InstanceType<typeof ConversationHistoryService> {
  return new ConversationHistoryService()
}

/**
 * Build a minimal JSONL string with optional ai-title and sessionId records.
 */
function buildJsonl(opts: {
  sessionId?: string
  aiTitle?: string
  extraLines?: string[]
}): string {
  const lines: string[] = []
  if (opts.sessionId) {
    lines.push(JSON.stringify({ sessionId: opts.sessionId, type: 'message' }))
  }
  if (opts.aiTitle && opts.sessionId) {
    lines.push(
      JSON.stringify({
        type: 'ai-title',
        sessionId: opts.sessionId,
        aiTitle: opts.aiTitle
      })
    )
  }
  if (opts.extraLines) {
    lines.push(...opts.extraLines)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ConversationHistoryService', () => {
  let tmpDir: string
  let projectPath: string
  let conversationsDir: string

  beforeEach(() => {
    vi.restoreAllMocks()

    // Create a real temp directory structure for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capybara-test-'))
    projectPath = '/Users/test/my-project'
    // Encoded: -Users-test-my-project
    const encoded = projectPath.replace(/\//g, '-')
    conversationsDir = path.join(tmpDir, '.claude', 'projects', encoded)
    fs.mkdirSync(conversationsDir, { recursive: true })

    // Patch homedir to point at our temp dir
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
  })

  // -------------------------------------------------------------------------
  // listConversations — happy path
  // -------------------------------------------------------------------------
  describe('listConversations()', () => {
    it('returns conversations sorted by lastActive descending', async () => {
      const service = createService()

      const id1 = '550e8400-e29b-41d4-a716-446655440001'
      const id2 = '550e8400-e29b-41d4-a716-446655440002'

      const file1 = path.join(conversationsDir, `${id1}.jsonl`)
      const file2 = path.join(conversationsDir, `${id2}.jsonl`)

      fs.writeFileSync(
        file1,
        buildJsonl({ sessionId: id1, aiTitle: 'First conversation' })
      )
      // Ensure file2 is newer by touching it slightly later
      fs.writeFileSync(
        file2,
        buildJsonl({ sessionId: id2, aiTitle: 'Second conversation' })
      )
      // Force different mtimes
      const older = new Date(Date.now() - 60000)
      fs.utimesSync(file1, older, older)

      const result = await service.listConversations(projectPath)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(id2)
      expect(result[0].title).toBe('Second conversation')
      expect(result[1].id).toBe(id1)
      expect(result[1].title).toBe('First conversation')
      expect(result[0].lastActive).toBeGreaterThan(result[1].lastActive)
    })

    it('returns "Untitled" when no ai-title record is found', async () => {
      const service = createService()
      const id = '550e8400-e29b-41d4-a716-446655440003'
      const file = path.join(conversationsDir, `${id}.jsonl`)

      // Write a file with sessionId but no ai-title
      fs.writeFileSync(
        file,
        JSON.stringify({ sessionId: id, type: 'message' }) + '\n'
      )

      const result = await service.listConversations(projectPath)

      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Untitled')
      expect(result[0].id).toBe(id)
    })

    it('uses filename as id when no sessionId in content', async () => {
      const service = createService()
      const filename = '550e8400-e29b-41d4-a716-446655440004'
      const file = path.join(conversationsDir, `${filename}.jsonl`)

      // Write content with no sessionId
      fs.writeFileSync(file, JSON.stringify({ type: 'message' }) + '\n')

      const result = await service.listConversations(projectPath)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(filename)
    })

    it('returns empty array when directory does not exist', async () => {
      const service = createService()

      const result = await service.listConversations('/nonexistent/path')

      expect(result).toEqual([])
    })

    it('returns empty array when directory has no jsonl files', async () => {
      const service = createService()

      // Write a non-jsonl file
      fs.writeFileSync(
        path.join(conversationsDir, 'readme.txt'),
        'not a conversation'
      )

      const result = await service.listConversations(projectPath)

      expect(result).toEqual([])
    })

    it('skips malformed JSONL lines gracefully', async () => {
      const service = createService()
      const id = '550e8400-e29b-41d4-a716-446655440005'
      const file = path.join(conversationsDir, `${id}.jsonl`)

      const content = [
        'not valid json',
        JSON.stringify({ sessionId: id, type: 'message' }),
        '{also broken',
        JSON.stringify({
          type: 'ai-title',
          sessionId: id,
          aiTitle: 'Recovered title'
        })
      ].join('\n')

      fs.writeFileSync(file, content + '\n')

      const result = await service.listConversations(projectPath)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(id)
      expect(result[0].title).toBe('Recovered title')
    })

    it('includes lastActive as a number (unix ms timestamp)', async () => {
      const service = createService()
      const id = '550e8400-e29b-41d4-a716-446655440006'
      const file = path.join(conversationsDir, `${id}.jsonl`)

      fs.writeFileSync(file, buildJsonl({ sessionId: id, aiTitle: 'Test' }))

      const result = await service.listConversations(projectPath)

      expect(result).toHaveLength(1)
      expect(typeof result[0].lastActive).toBe('number')
      expect(result[0].lastActive).toBeGreaterThan(0)
    })

    it('ignores subdirectories in the conversations dir', async () => {
      const service = createService()

      // Create a subdirectory that looks like a jsonl file (edge case)
      fs.mkdirSync(path.join(conversationsDir, 'subdir.jsonl'))

      const result = await service.listConversations(projectPath)

      expect(result).toEqual([])
    })
  })
})
