import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { SessionNotFoundError } from '@/main/lib/errors'
import { TEST_UUIDS } from '../../fixtures/uuids'

// ---------------------------------------------------------------------------
// Mock logger (used by SessionService internally)
// ---------------------------------------------------------------------------
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({
  logger: mockLogger
}))

// ---------------------------------------------------------------------------
// Mock the SDK dynamic import
// ---------------------------------------------------------------------------
const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args)
}))

// Import after mocks
const { SessionService } = await import(
  '@/main/services/session'
)
const { ClaudeConnection } = await import('@/main/claude/connection')
const claudeHistory = await import('@/main/claude/history')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_CWD = '/Users/test/project'

function createManager(): InstanceType<typeof SessionService> {
  return new SessionService({
    connectionFactory: (ctx) => new ClaudeConnection(ctx),
    conversations: {
      listConversations: claudeHistory.listConversations,
      loadConversationMessages: claudeHistory.loadConversationMessages,
      renameConversation: claudeHistory.renameConversation
    }
  })
}

/**
 * Create a session and wait briefly for the async SDK loop to start.
 * The mock query returns an empty async iterable by default.
 */
async function createDefaultSession(
  manager: InstanceType<typeof SessionService>,
  overrides?: { cwd?: string; resumeId?: string }
) {
  const descriptor = await manager.create(
    overrides?.cwd ?? VALID_CWD,
    overrides?.resumeId
  )
  // Allow the startSessionLoop microtask to proceed. Use waitUntil (predicate)
  // instead of waitFor(expect) so we don't trip no-conditional-expect, and
  // swallow timeouts because some tests intentionally never invoke mockQuery.
  await vi
    .waitUntil(() => mockQuery.mock.calls.length > 0, { timeout: 100 })
    .catch(() => {
      // If SDK loop hasn't started yet, that's ok for some tests
    })
  return descriptor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SessionService', () => {
  beforeAll(() => {
    // Suppress MaxListenersExceeded warning from creating many SessionService instances.
    // Each test creates its own SessionService which adds exit listeners to process.
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: query returns an async iterable that hangs (like a real session)
    // until the abort signal fires. Tests that need immediate exit can override.
    mockQuery.mockImplementation(({ abortController }: { abortController?: AbortController } = {}) => {
      return (async function* () {
        // Hang indefinitely until aborted
        await new Promise((_, reject) => {
          if (abortController) {
            abortController.signal.addEventListener('abort', () => reject(new Error('aborted')))
          }
        })
      })()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('returns a valid SessionDescriptor with required fields', async () => {
      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)

      expect(descriptor).toHaveProperty('id')
      expect(typeof descriptor.id).toBe('string')
      expect(descriptor.id.length).toBeGreaterThan(0)
      expect(descriptor.status).toBe('running')
      expect(descriptor.exitCode).toBeNull()
      expect(typeof descriptor.createdAt).toBe('number')
    })

    it('assigns unique IDs to each session', async () => {
      const manager = createManager()
      const d1 = await manager.create(VALID_CWD)
      const d2 = await manager.create(VALID_CWD)

      expect(d1.id).not.toBe(d2.id)
    })

    it('throws when global session cap is reached', async () => {
      const manager = createManager()

      // Create MAX_GLOBAL_SESSIONS (20) sessions across different cwds
      for (let i = 0; i < 20; i++) {
        await manager.create(`/Users/test/project-${i % 5}`)
      }

      await expect(
        manager.create('/Users/test/project-new')
      ).rejects.toThrow(/maximum.*20.*sessions/i)
    })

    it('throws when per-project cap is reached for the same cwd', async () => {
      const manager = createManager()
      const cwd = '/Users/test/capped-project'

      // MAX_AGENTS_PER_PROJECT is 5
      for (let i = 0; i < 5; i++) {
        await manager.create(cwd)
      }

      await expect(
        manager.create(cwd)
      ).rejects.toThrow(/maximum.*5.*active sessions/i)
    })

    it('allows sessions in different cwds beyond per-project cap', async () => {
      const manager = createManager()

      for (let i = 0; i < 5; i++) {
        await manager.create('/Users/test/project-a')
      }

      await expect(manager.create('/Users/test/project-b')).resolves.toBeDefined()
    })

    it('resets the destroying flag on create', async () => {
      const manager = createManager()
      await manager.create(VALID_CWD)
      manager.destroyAll()

      // After destroyAll, create should work (destroying flag is reset)
      const descriptor = await manager.create(VALID_CWD)
      expect(descriptor.status).toBe('running')
    })

    it('does not leak internal session properties in descriptor', async () => {
      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)

      // transport was removed — only one transport (SDK) remains
      expect(descriptor).not.toHaveProperty('transport')
      expect(descriptor).not.toHaveProperty('abortController')
      expect(descriptor).not.toHaveProperty('pushMessage')
      expect(descriptor).not.toHaveProperty('usageSummary')
      expect(descriptor).not.toHaveProperty('childPid')
    })
  })

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------
  describe('destroy()', () => {
    it('removes the session from the manager', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      manager.destroy(descriptor.id)

      expect(manager.list()).toHaveLength(0)
    })

    it('is a silent no-op for unknown ID', () => {
      const manager = createManager()
      expect(() => manager.destroy('nonexistent-id')).not.toThrow()
    })

    it('is a silent no-op when destroying same session twice', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      manager.destroy(descriptor.id)
      expect(() => manager.destroy(descriptor.id)).not.toThrow()
    })

    it('cleans up message history on destroy', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      manager.destroy(descriptor.id)

      // Attempting to get messages for destroyed session should throw
      expect(() => manager.getMessages(descriptor.id)).toThrow(
        SessionNotFoundError
      )
    })

    it('cleans up pending approvals for the session', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      // The approval cleanup is internal — we verify it does not throw
      manager.destroy(descriptor.id)
      expect(manager.list()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // destroyAll()
  // -------------------------------------------------------------------------
  describe('destroyAll()', () => {
    it('removes all sessions', async () => {
      const manager = createManager()
      await createDefaultSession(manager)
      await createDefaultSession(manager)

      manager.destroyAll()

      expect(manager.list()).toHaveLength(0)
    })

    it('is safe to call when no sessions exist', () => {
      const manager = createManager()
      expect(() => manager.destroyAll()).not.toThrow()
    })

    it('sets the destroying flag to prevent SDK loop callbacks', async () => {
      const manager = createManager()

      // Create a session with a long-running query
      let resolveQuery = null as (() => void) | null
      mockQuery.mockImplementation(() => {
        return (async function* () {
          await new Promise<void>((r) => {
            resolveQuery = r
          })
        })()
      })

      await manager.create(VALID_CWD)
      manager.destroyAll()

      // Resolve the pending query — should not cause errors since destroying=true
      if (resolveQuery) resolveQuery()

      expect(manager.list()).toHaveLength(0)
    })

    it('clears all message history', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      manager.destroyAll()

      // No sessions to query messages for
      expect(manager.list()).toHaveLength(0)
    })

    it('clears all pending approvals', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      manager.destroyAll()
      expect(manager.list()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns empty array when no sessions exist', () => {
      const manager = createManager()
      expect(manager.list()).toEqual([])
    })

    it('returns all created sessions', async () => {
      const manager = createManager()
      await createDefaultSession(manager)
      await createDefaultSession(manager)

      expect(manager.list()).toHaveLength(2)
    })

    it('returns descriptors without internal properties', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      const [descriptor] = manager.list()

      expect(descriptor).toHaveProperty('id')
      expect(descriptor).toHaveProperty('status')
      expect(descriptor).toHaveProperty('exitCode')
      expect(descriptor).toHaveProperty('createdAt')
      expect(descriptor).not.toHaveProperty('transport')
      expect(descriptor).not.toHaveProperty('abortController')
    })

    it('does not include destroyed sessions', async () => {
      const manager = createManager()
      const d1 = await createDefaultSession(manager)
      await createDefaultSession(manager)

      manager.destroy(d1.id)

      expect(manager.list()).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // write()
  // -------------------------------------------------------------------------
  describe('write()', () => {
    it('throws SessionNotFoundError for unknown session', () => {
      const manager = createManager()

      expect(() => manager.write('nonexistent', 'hello')).toThrow(
        SessionNotFoundError
      )
    })

    it('silently warns when session is not running', async () => {
      const manager = createManager()

      // Create a session that exits immediately
      mockQuery.mockImplementation(() => {
        return (async function* () {
          // exits immediately
        })()
      })

      const descriptor = await manager.create(VALID_CWD)
      // Wait for the session to exit
      await new Promise((r) => setTimeout(r, 50))

      // Session may have exited and been removed, or still exist but not running.
      // Either way, write should either succeed or throw SessionNotFoundError —
      // anything else is a regression.
      const writeThrow = (): void => {
        try {
          manager.write(descriptor.id, 'test')
        } catch (err) {
          if (err instanceof SessionNotFoundError) return
          throw err
        }
      }
      expect(writeThrow).not.toThrow()
    })

    it('warns when pushMessage is null (session not ready)', async () => {
      const manager = createManager()

      // Create a blocking query that never resolves (so pushMessage stays null briefly)
      let blockResolve = null as (() => void) | null
      mockQuery.mockImplementation(() => {
        return (async function* () {
          await new Promise<void>((r) => {
            blockResolve = r
          })
        })()
      })

      const descriptor = await manager.create(VALID_CWD)
      // pushMessage is set synchronously by createMessageStream, so it should be
      // available immediately after create returns. Verify the write path does
      // not crash while the blocking query is still pending.
      expect(() => manager.write(descriptor.id, 'test message')).not.toThrow()

      // Cleanup
      manager.destroy(descriptor.id)
      if (blockResolve) (blockResolve as () => void)()
    })

    it('delivers message to the SDK query prompt', { timeout: 10_000 }, async () => {
      const manager = createManager()
      const receivedMessages: unknown[] = []

      // Use a unique CWD to distinguish this test's query call from stale
      // background startSessionLoop calls left over from previous tests.
      const UNIQUE_CWD = '/Users/test/write-deliver-test'
      let queryReady: () => void
      const queryReadyPromise = new Promise<void>((r) => {
        queryReady = r
      })

      // Mock query that captures messages yielded from the prompt iterable
      mockQuery.mockImplementation(({ prompt, options }: { prompt: AsyncIterable<unknown>; options?: { cwd?: string } }) => {
        // Only signal readiness for THIS test's session
        if (options?.cwd === UNIQUE_CWD) {
          // Consume the prompt in the background
          void (async () => {
            for await (const msg of prompt) {
              receivedMessages.push(msg)
            }
          })()
          queryReady()
        }

        return (async function* () {
          // Hang until we've received a message or timeout
          await new Promise((r) => setTimeout(r, 200))
        })()
      })

      const descriptor = await manager.create(UNIQUE_CWD)
      // Wait for THIS session's query to start
      await queryReadyPromise

      manager.write(descriptor.id, 'hello from user')

      // Wait for the message to be received by the mock query
      await vi.waitFor(() => {
        expect(receivedMessages).toHaveLength(1)
      }, { timeout: 2000 })

      const msg = receivedMessages[0] as Record<string, unknown>
      expect(msg).toEqual({
        type: 'user',
        session_id: descriptor.id,
        message: { role: 'user', content: 'hello from user' },
        parent_tool_use_id: null
      })

      // Cleanup
      manager.destroy(descriptor.id)
    })

    it('buffers messages when multiple are sent before SDK consumes', async () => {
      const manager = createManager()
      const receivedMessages: unknown[] = []
      let startConsuming = null as (() => void) | null

      // Use a unique CWD to distinguish this test's query call from stale
      // background startSessionLoop calls left over from previous tests.
      const UNIQUE_CWD = '/Users/test/write-buffer-test'
      let queryReady: () => void
      const queryReadyPromise = new Promise<void>((r) => {
        queryReady = r
      })

      // Mock query that waits before consuming the prompt
      mockQuery.mockImplementation(({ prompt, options }: { prompt: AsyncIterable<unknown>; options?: { cwd?: string } }) => {
        // Only set up consumption for THIS test's session
        if (options?.cwd === UNIQUE_CWD) {
          void (async () => {
            // Wait for signal before starting to consume
            await new Promise<void>((r) => { startConsuming = r })
            for await (const msg of prompt) {
              receivedMessages.push(msg)
              // Stop after collecting 3 messages
              if (receivedMessages.length >= 3) break
            }
          })()
          queryReady()
        }

        return (async function* () {
          await new Promise((r) => setTimeout(r, 500))
        })()
      })

      const descriptor = await manager.create(UNIQUE_CWD)
      // Wait for THIS session's query to start
      await queryReadyPromise

      // Push 3 messages before the SDK starts consuming
      manager.write(descriptor.id, 'first')
      manager.write(descriptor.id, 'second')
      manager.write(descriptor.id, 'third')

      // Now let the SDK consume
      startConsuming!()

      // All 3 messages should be delivered in order
      await vi.waitFor(() => {
        expect(receivedMessages).toHaveLength(3)
      }, { timeout: 300 })

      const contents = receivedMessages.map((m) => {
        const msg = m as { message: { content: string } }
        return msg.message.content
      })
      expect(contents).toEqual(['first', 'second', 'third'])

      // Cleanup
      manager.destroy(descriptor.id)
    })
  })

  // -------------------------------------------------------------------------
  // getMessages()
  // -------------------------------------------------------------------------
  describe('getMessages()', () => {
    it('returns empty array for a session with no messages', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      const messages = manager.getMessages(descriptor.id)

      expect(messages).toEqual([])
    })

    it('throws SessionNotFoundError for unknown session', () => {
      const manager = createManager()

      expect(() => manager.getMessages('nonexistent')).toThrow(
        SessionNotFoundError
      )
    })
  })

  // -------------------------------------------------------------------------
  // handleToolApprovalResponse()
  // -------------------------------------------------------------------------
  describe('handleToolApprovalResponse()', () => {
    it('warns when no pending approval exists for the given key', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      manager.handleToolApprovalResponse(
        'any-session-id',
        'any-tool-use-id',
        'approve',
        null
      )

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No pending approval found for key',
        expect.objectContaining({
          sessionId: 'any-session-id',
          toolUseId: 'any-tool-use-id'
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Tool policy enforcement
  // -------------------------------------------------------------------------
  describe('tool policy enforcement', () => {
    it('SDK query receives a canUseTool callback in options', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            canUseTool: expect.any(Function)
          })
        })
      )
    })

    it('canUseTool allows read-only tools', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      const readResult = await canUseTool('Read', {}, {})
      expect(readResult.behavior).toBe('allow')

      const globResult = await canUseTool('Glob', {}, {})
      expect(globResult.behavior).toBe('allow')

      const grepResult = await canUseTool('Grep', {}, {})
      expect(grepResult.behavior).toBe('allow')

      const webSearchResult = await canUseTool('WebSearch', {}, {})
      expect(webSearchResult.behavior).toBe('allow')

      const webFetchResult = await canUseTool('WebFetch', {}, {})
      expect(webFetchResult.behavior).toBe('allow')
    })

    it('canUseTool allows AskUserQuestion tool', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      const result = await canUseTool('AskUserQuestion', {}, {})
      expect(result.behavior).toBe('allow')
    })

    it('canUseTool forwards write tools to UI for approval', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      // Listen for the tool-approval event and respond with deny
      manager.on(
        'tool-approval',
        (req: { sessionId: string; toolUseId: string; toolName: string }) => {
          manager.handleToolApprovalResponse(
            req.sessionId,
            req.toolUseId,
            'deny',
            `Tool "${req.toolName}" denied by user`
          )
        }
      )

      const writeResult = await canUseTool('Write', {}, { toolUseId: 'w1' })
      expect(writeResult.behavior).toBe('deny')
      expect(writeResult.message).toContain('denied by user')

      const editResult = await canUseTool('Edit', {}, { toolUseId: 'e1' })
      expect(editResult.behavior).toBe('deny')

      const bashResult = await canUseTool('Bash', {}, { toolUseId: 'b1' })
      expect(bashResult.behavior).toBe('deny')

      manager.destroy(descriptor.id)
    })

    it('canUseTool forwards unknown tools to UI for approval', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      // Auto-deny via the tool-approval event
      manager.on(
        'tool-approval',
        (req: { sessionId: string; toolUseId: string }) => {
          manager.handleToolApprovalResponse(req.sessionId, req.toolUseId, 'deny', null)
        }
      )

      const result = await canUseTool('SomeFutureTool', {}, { toolUseId: 'u1' })
      expect(result.behavior).toBe('deny')

      manager.destroy(descriptor.id)
    })

    it('canUseTool approves write tools when user approves', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      // Auto-approve via the tool-approval event
      manager.on(
        'tool-approval',
        (req: { sessionId: string; toolUseId: string }) => {
          manager.handleToolApprovalResponse(req.sessionId, req.toolUseId, 'approve', null)
        }
      )

      const writeResult = await canUseTool('Write', {}, { toolUseId: 'w2' })
      expect(writeResult.behavior).toBe('allow')

      manager.destroy(descriptor.id)
    })

    it('canUseTool emits tool-approval with context fields', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      const approvalEvents: unknown[] = []
      manager.on(
        'tool-approval',
        (req: {
          sessionId: string
          toolUseId: string
          toolName: string
          input: Record<string, unknown>
          title?: string
          description?: string
          reason?: string
        }) => {
          approvalEvents.push({
            sessionId: req.sessionId,
            toolUseId: req.toolUseId,
            toolName: req.toolName,
            input: req.input,
            title: req.title,
            description: req.description,
            reason: req.reason
          })
          manager.handleToolApprovalResponse(req.sessionId, req.toolUseId, 'approve', null)
        }
      )

      await canUseTool(
        'Write',
        { file: 'test.ts' },
        { toolUseId: 'ctx1', title: 'Write File', description: 'Writing test.ts', decisionReason: 'file write' }
      )

      expect(approvalEvents).toHaveLength(1)
      const evt = approvalEvents[0] as Record<string, unknown>
      expect(evt.toolName).toBe('Write')
      expect(evt.title).toBe('Write File')
      expect(evt.description).toBe('Writing test.ts')
      expect(evt.reason).toBe('file write')

      manager.destroy(descriptor.id)
    })
  })

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------
  describe('event emission', () => {
    it('emits "message" events for SDK messages', async () => {
      const messageEvents: { sessionId: string; message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4-20250514',
            tools: ['Read'],
            cwd: VALID_CWD,
            claude_code_version: '1.0.0'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (sessionId: string, message: unknown) => {
        messageEvents.push({ sessionId, message })
      })

      const descriptor = await manager.create(VALID_CWD)
      // Wait for the SDK loop to process
      await new Promise((r) => setTimeout(r, 50))

      expect(messageEvents.length).toBeGreaterThan(0)
      const initMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'system_message'
      )
      expect(initMsg).toBeDefined()
      expect(initMsg!.sessionId).toBe(descriptor.id)
    })

    it('emits "exited" events when SDK loop completes', async () => {
      const exitEvents: { sessionId: string; exitCode: number }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          // empty — ends immediately
        })()
      })

      const manager = createManager()
      manager.on('exited', (sessionId: string, exitCode: number) => {
        exitEvents.push({ sessionId, exitCode })
      })

      const descriptor = await manager.create(VALID_CWD)
      // Wait for the SDK loop to complete
      await new Promise((r) => setTimeout(r, 50))

      expect(exitEvents).toHaveLength(1)
      expect(exitEvents[0].sessionId).toBe(descriptor.id)
      expect(exitEvents[0].exitCode).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // SDK message translation
  // -------------------------------------------------------------------------
  describe('SDK message translation', () => {
    it('translates assistant messages with content blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Hello, world!' },
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'Read',
                  input: { file: 'test.ts' }
                }
              ],
              model: 'claude-sonnet-4-20250514',
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 10,
                cache_creation_input_tokens: 5
              }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const assistantMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { kind: string; content: unknown[]; model: string; usage: unknown } } | undefined
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.message.model).toBe('claude-sonnet-4-20250514')

      // Should also emit tool_use_request for the tool_use block
      const toolUseMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_use_request'
      ) as { message: { toolName: string; requiresApproval: boolean } } | undefined
      expect(toolUseMsg).toBeDefined()
      expect(toolUseMsg!.message.toolName).toBe('Read')
      expect(toolUseMsg!.message.requiresApproval).toBe(false) // Read is read-only
    })

    it('translates stream_event text deltas', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'streaming text' }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const deltaMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_text_delta'
      ) as { message: { text: string } } | undefined
      expect(deltaMsg).toBeDefined()
      expect(deltaMsg!.message.text).toBe('streaming text')
    })

    it('translates system init messages and strips sensitive fields', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4-20250514',
            tools: ['Read', 'Write'],
            cwd: VALID_CWD,
            claude_code_version: '1.0.0',
            apiKeySource: 'environment', // sensitive — should be stripped
            auth: { token: 'secret' } // sensitive — should be stripped
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const sysMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'system_message'
      ) as { message: { text: string; messageType: string } } | undefined
      expect(sysMsg).toBeDefined()
      expect(sysMsg!.message.messageType).toBe('init')
      // The text should not contain apiKeySource or auth
      expect(sysMsg!.message.text).not.toContain('apiKeySource')
      expect(sysMsg!.message.text).not.toContain('secret')
    })

    it('translates system compact_boundary messages', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'compact_boundary' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const compactMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'system_message'
      ) as { message: { messageType: string; text: string } } | undefined
      expect(compactMsg).toBeDefined()
      expect(compactMsg!.message.messageType).toBe('compact_boundary')
      expect(compactMsg!.message.text).toBe('Context window compacted')
    })

    it('translates result messages with error subtypes', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'result',
            is_error: true,
            subtype: 'error_max_turns',
            errors: ['Max turns exceeded'],
            session_id: '',
            total_cost_usd: 0.15,
            usage: { input_tokens: 500, output_tokens: 200 }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { code: string; message: string; recoverable: boolean } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.code).toBe('context_limit')
      expect(errorMsg!.message.message).toBe('Max turns exceeded')
      expect(errorMsg!.message.recoverable).toBe(true)
    })

    it('translates result messages with non-recoverable errors', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'result',
            is_error: true,
            subtype: 'error_during_execution',
            errors: ['Tool crashed'],
            session_id: ''
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { code: string; recoverable: boolean } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.code).toBe('tool_error')
      expect(errorMsg!.message.recoverable).toBe(false)
    })

    it('drops unknown SDK message types silently', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'hook_progress', data: 'something' }
          yield { type: 'task_notification', data: 'something else' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Should not have emitted any messages for unknown types
      expect(messageEvents).toHaveLength(0)
    })

    it('emits usage_message after each assistant message', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Hello' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 100, output_tokens: 50 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const usageMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'usage_message'
      ) as { message: { turnUsage: { inputTokens: number; outputTokens: number }; summary: { turnCount: number } } } | undefined
      expect(usageMsg).toBeDefined()
      expect(usageMsg!.message.turnUsage.inputTokens).toBe(100)
      expect(usageMsg!.message.turnUsage.outputTokens).toBe(50)
      expect(usageMsg!.message.summary.turnCount).toBe(1)
    })

    it('does NOT emit tool_use_request for write tools (approval handled via tool-approval channel)', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'tool-1', name: 'Write', input: { file: 'test.ts' } }
              ],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 10, output_tokens: 5 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Write is not in AUTO_APPROVE_TOOLS, so handleAssistantMessage should
      // NOT emit a tool_use_request for it. The approval flow (onToolApprovalRequest)
      // is the sole source for write tool messages in the UI.
      const toolUseMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_use_request'
      )
      expect(toolUseMsg).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Error handling in SDK loop
  // -------------------------------------------------------------------------
  describe('SDK loop error handling', () => {
    it('emits error_message when SDK loop throws a non-AbortError', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          throw new Error('SDK connection failed')
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { code: string; message: string } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.code).toBe('unknown')
      expect(errorMsg!.message.message).toBe('SDK connection failed')
    })

    it('handles AbortError silently (expected during session destroy)', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          throw err
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Should NOT emit error_message for AbortError
      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      )
      expect(errorMsg).toBeUndefined()
    })

    it('logs and handles SDK import failure', async () => {
      // Override the SDK mock to simulate import failure
      // We need to test the error path when the SDK is not installed
      // Since we mocked the import globally, this specific test validates
      // that the startSessionLoop catch works by verifying error logging
      // for non-SDK errors
      mockQuery.mockImplementation(() => {
        throw new TypeError('query is not a function')
      })

      const manager = createManager()
      const exitEvents: unknown[] = []
      manager.on('exited', (...args: unknown[]) => {
        exitEvents.push(args)
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // The error should have been logged
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Message history tracking
  // -------------------------------------------------------------------------
  describe('message history tracking', () => {
    it('stores emitted messages in getMessages()', async () => {
      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4-20250514',
            tools: [],
            cwd: VALID_CWD,
            claude_code_version: '1.0.0'
          }
        })()
      })

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const messages = manager.getMessages(descriptor.id)
      expect(messages.length).toBeGreaterThan(0)
      expect((messages[0] as { kind: string }).kind).toBe('system_message')
    })
  })

  // -------------------------------------------------------------------------
  // Session metadata
  // -------------------------------------------------------------------------
  describe('session metadata', () => {
    it('does not include model or contextWindow at creation time', async () => {
      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)

      // These are populated later from the SDK init message
      expect(descriptor.metadata!.model).toBeUndefined()
      expect(descriptor.metadata!.contextWindow).toBeUndefined()
    })

    it('updates metadata from system init message', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-opus-4-20250514',
            tools: ['Read'],
            cwd: VALID_CWD,
            claude_code_version: '2.1.87',
            betas: ['context-1m-2025-08-07']
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const metadataMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'metadata_updated'
      ) as {
        message: {
          kind: string
          metadata: {
            model: string
            contextWindow: string
            claudeCodeVersion: string
          }
        }
      } | undefined

      expect(metadataMsg).toBeDefined()
      expect(metadataMsg!.message.metadata.model).toBe(
        'claude-opus-4-20250514'
      )
      expect(metadataMsg!.message.metadata.contextWindow).toBe('1M context')
      expect(metadataMsg!.message.metadata.claudeCodeVersion).toBe('2.1.87')
    })

    it('defaults contextWindow to 200k when no context beta present', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4-20250514',
            tools: ['Read'],
            cwd: VALID_CWD,
            claude_code_version: '2.1.87',
            betas: []
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const metadataMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'metadata_updated'
      ) as {
        message: { metadata: { contextWindow: string } }
      } | undefined

      expect(metadataMsg).toBeDefined()
      expect(metadataMsg!.message.metadata.contextWindow).toBe('200k')
    })

    it('reflects updated metadata in list() after init', async () => {
      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-opus-4-20250514',
            tools: [],
            cwd: VALID_CWD,
            claude_code_version: '2.1.87',
            betas: ['context-1m-2025-08-07']
          }
        })()
      })

      const manager = createManager()
      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const [descriptor] = manager.list()
      expect(descriptor.metadata!.model).toBe('claude-opus-4-20250514')
      expect(descriptor.metadata!.contextWindow).toBe('1M context')
    })

    it('does not include sdkMetadata internal field in descriptor', async () => {
      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)

      expect(descriptor).not.toHaveProperty('sdkMetadata')
    })

    it('handles init message without betas array', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            model: 'claude-sonnet-4-20250514',
            tools: [],
            cwd: VALID_CWD,
            claude_code_version: '2.1.87'
            // no betas field
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const metadataMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'metadata_updated'
      ) as {
        message: { metadata: { model: string; contextWindow?: string } }
      } | undefined

      expect(metadataMsg).toBeDefined()
      expect(metadataMsg!.message.metadata.model).toBe(
        'claude-sonnet-4-20250514'
      )
      // contextWindow should not be set since no betas were present
      expect(metadataMsg!.message.metadata.contextWindow).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Environment sanitization
  // -------------------------------------------------------------------------
  describe('environment sanitization', () => {
    it('passes env to query options without Electron-specific vars', async () => {
      // Set some Electron env vars that should be stripped
      process.env.ELECTRON_RUN_AS_NODE = '1'
      process.env.ELECTRON_NO_ASAR = '1'

      const manager = createManager()
      await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      const env = callArgs.options.env

      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
      expect(env.ELECTRON_NO_ASAR).toBeUndefined()

      // Cleanup
      delete process.env.ELECTRON_RUN_AS_NODE
      delete process.env.ELECTRON_NO_ASAR
    })
  })

  // -------------------------------------------------------------------------
  // Resume session
  // -------------------------------------------------------------------------
  describe('resume session', () => {
    it('passes resume option to SDK query when resumeId is provided', async () => {
      const manager = createManager()
      const resumeId = TEST_UUIDS.session
      await createDefaultSession(manager, { resumeId })

      const callArgs = mockQuery.mock.calls[0][0]
      expect(callArgs.options.resume).toBe(resumeId)
    })

    it('does not pass resume option when resumeId is undefined', async () => {
      const manager = createManager()
      await createDefaultSession(manager)

      const callArgs = mockQuery.mock.calls[0][0]
      expect(callArgs.options.resume).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Conversation ID tracking and abort-resume
  // -------------------------------------------------------------------------
  describe('conversation ID tracking', () => {
    /**
     * Helper: creates a mock query that yields the given messages then
     * hangs until the abort signal fires, mimicking a real SDK session.
     */
    function mockQueryWithMessages(messages: Record<string, unknown>[]) {
      return ({ options }: { prompt: AsyncIterable<unknown>; options?: { abortController?: AbortController } }) => {
        return (async function* () {
          for (const msg of messages) {
            yield msg
          }
          // Hang until aborted (like a real session waiting for input)
          await new Promise<void>((_, reject) => {
            const signal = options?.abortController?.signal
            if (signal) {
              const makeAbortError = () => {
                const err = new Error('The operation was aborted')
                err.name = 'AbortError'
                return err
              }
              if (signal.aborted) { reject(makeAbortError()); return }
              signal.addEventListener('abort', () => reject(makeAbortError()))
            }
          })
        })()
      }
    }

    /** Helper: creates a mock query that just hangs until aborted. */
    function mockQueryHanging() {
      return mockQueryWithMessages([])
    }

    it('captures conversation ID from SDK system init message', { timeout: 10_000 }, async () => {
      const SDK_SESSION_ID = 'abc-def-ghi-jkl-mno'

      mockQuery.mockImplementation(mockQueryWithMessages([{
        type: 'system',
        subtype: 'init',
        session_id: SDK_SESSION_ID,
        model: 'claude-opus-4-20250514',
        tools: ['Read'],
        cwd: VALID_CWD,
        claude_code_version: '2.1.87'
      }]))

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Set up the restart mock before aborting
      mockQuery.mockImplementation(mockQueryHanging())

      manager.stopResponse(descriptor.id)

      // abort() fires startSessionLoop which calls mockQuery.
      // Give the microtask a tick to execute.
      await new Promise((r) => setTimeout(r, 50))

      // The restart call should have called query with the captured conversation ID
      // Count calls AFTER the one from create() -- find the call with the resume option
      const allCalls = mockQuery.mock.calls
      const resumeCalls = allCalls.filter(
        (call: unknown[]) => (call[0] as { options?: { resume?: string } })?.options?.resume === SDK_SESSION_ID
      )
      expect(resumeCalls).toHaveLength(1)

      manager.destroyAll()
    })

    it('captures conversation ID from result message when init had none', { timeout: 10_000 }, async () => {
      const SDK_SESSION_ID = 'result-session-id-123'

      mockQuery.mockImplementation(mockQueryWithMessages([
        {
          type: 'system',
          subtype: 'init',
          model: 'claude-opus-4-20250514',
          tools: ['Read'],
          cwd: VALID_CWD,
          claude_code_version: '2.1.87'
          // no session_id
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: SDK_SESSION_ID,
          total_cost_usd: 0.01,
          is_error: false
        }
      ]))

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      mockQuery.mockImplementation(mockQueryHanging())
      manager.stopResponse(descriptor.id)
      await new Promise((r) => setTimeout(r, 50))

      const allCalls = mockQuery.mock.calls
      const resumeCalls = allCalls.filter(
        (call: unknown[]) => (call[0] as { options?: { resume?: string } })?.options?.resume === SDK_SESSION_ID
      )
      expect(resumeCalls).toHaveLength(1)

      manager.destroyAll()
    })

    it('initializes conversation ID from resumeId on create', { timeout: 10_000 }, async () => {
      const RESUME_ID = TEST_UUIDS.session

      mockQuery.mockImplementation(mockQueryHanging())

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD, RESUME_ID)
      await new Promise((r) => setTimeout(r, 50))

      // Record how many calls have been made so far (from create)
      const callsBeforeAbort = mockQuery.mock.calls.length

      mockQuery.mockImplementation(mockQueryHanging())
      manager.stopResponse(descriptor.id)
      await new Promise((r) => setTimeout(r, 50))

      // The restart call (after abort) should also pass the resumeId
      const callsAfterAbort = mockQuery.mock.calls.slice(callsBeforeAbort)
      expect(callsAfterAbort.length).toBeGreaterThanOrEqual(1)
      const restartArgs = callsAfterAbort[callsAfterAbort.length - 1][0] as {
        options?: { resume?: string }
      }
      expect(restartArgs.options?.resume).toBe(RESUME_ID)

      manager.destroyAll()
    })

    it('SDK init session_id overrides initial resumeId', { timeout: 10_000 }, async () => {
      const INITIAL_RESUME = 'original-resume-id'
      const SDK_SESSION_ID = 'sdk-provided-session-id'

      mockQuery.mockImplementation(mockQueryWithMessages([{
        type: 'system',
        subtype: 'init',
        session_id: SDK_SESSION_ID,
        model: 'claude-opus-4-20250514',
        tools: ['Read'],
        cwd: VALID_CWD,
        claude_code_version: '2.1.87'
      }]))

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD, INITIAL_RESUME)
      await new Promise((r) => setTimeout(r, 50))

      mockQuery.mockImplementation(mockQueryHanging())
      manager.stopResponse(descriptor.id)
      await new Promise((r) => setTimeout(r, 50))

      // The SDK-provided session_id should take precedence
      const allCalls = mockQuery.mock.calls
      const resumeCalls = allCalls.filter(
        (call: unknown[]) => (call[0] as { options?: { resume?: string } })?.options?.resume === SDK_SESSION_ID
      )
      expect(resumeCalls).toHaveLength(1)

      manager.destroyAll()
    })

    it('abort without conversation ID does not pass resume option', { timeout: 10_000 }, async () => {
      mockQuery.mockImplementation(mockQueryHanging())

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      mockQuery.mockImplementation(mockQueryHanging())
      manager.stopResponse(descriptor.id)
      await new Promise((r) => setTimeout(r, 50))

      // Find the call made AFTER abort (will be the last call since
      // abort restarts the loop). Its resume should be undefined.
      const allCalls = mockQuery.mock.calls
      expect(allCalls.length).toBeGreaterThanOrEqual(2) // create + restart
      const lastCallArgs = allCalls[allCalls.length - 1][0] as {
        options?: { resume?: string }
      }
      expect(lastCallArgs.options?.resume).toBeUndefined()

      manager.destroyAll()
    })

    it('does not leak conversationId in descriptor', async () => {
      const SDK_SESSION_ID = 'should-not-leak'

      mockQuery.mockImplementation(mockQueryWithMessages([{
        type: 'system',
        subtype: 'init',
        session_id: SDK_SESSION_ID,
        model: 'claude-opus-4-20250514',
        tools: ['Read'],
        cwd: VALID_CWD,
        claude_code_version: '2.1.87'
      }]))

      const manager = createManager()
      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const listed = manager.list()
      expect(listed).toHaveLength(1)
      expect(listed[0]).not.toHaveProperty('conversationId')

      manager.destroyAll()
    })

    it('does not overwrite conversation ID from result when init already set it', { timeout: 10_000 }, async () => {
      const INIT_SESSION_ID = 'from-init'
      const RESULT_SESSION_ID = 'from-result'

      mockQuery.mockImplementation(mockQueryWithMessages([
        {
          type: 'system',
          subtype: 'init',
          session_id: INIT_SESSION_ID,
          model: 'claude-opus-4-20250514',
          tools: ['Read'],
          cwd: VALID_CWD,
          claude_code_version: '2.1.87'
        },
        {
          type: 'result',
          subtype: 'success',
          session_id: RESULT_SESSION_ID,
          total_cost_usd: 0.01,
          is_error: false
        }
      ]))

      const manager = createManager()
      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      mockQuery.mockImplementation(mockQueryHanging())
      manager.stopResponse(descriptor.id)
      await new Promise((r) => setTimeout(r, 50))

      // Init-provided ID should win (result is a fallback only)
      const allCalls = mockQuery.mock.calls
      const resumeCalls = allCalls.filter(
        (call: unknown[]) => (call[0] as { options?: { resume?: string } })?.options?.resume === INIT_SESSION_ID
      )
      expect(resumeCalls).toHaveLength(1)
      // Verify result's session_id was NOT used
      const resultCalls = allCalls.filter(
        (call: unknown[]) => (call[0] as { options?: { resume?: string } })?.options?.resume === RESULT_SESSION_ID
      )
      expect(resultCalls).toHaveLength(0)

      manager.destroyAll()
    })
  })

  // -------------------------------------------------------------------------
  // Thinking delta translation
  // -------------------------------------------------------------------------
  describe('thinking delta translation', () => {
    it('translates stream_event thinking_delta into ThinkingDelta message', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: 'Let me analyze...' }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const thinkingMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'thinking_delta'
      ) as { message: { kind: string; text: string } } | undefined
      expect(thinkingMsg).toBeDefined()
      expect(thinkingMsg!.message.text).toBe('Let me analyze...')
    })

    it('passes through thinking_delta even with non-string thinking field', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: 42 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Translator passes through whatever value the SDK provides —
      // runtime validation is the SDK's responsibility.
      const thinkingMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'thinking_delta'
      ) as { message: { text: unknown } } | undefined
      expect(thinkingMsg).toBeDefined()
      expect(thinkingMsg!.message.text).toBe(42)
    })

    it('ignores stream_event with missing event field', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'stream_event' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      expect(messageEvents).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // Tool progress translation
  // -------------------------------------------------------------------------
  describe('tool progress translation', () => {
    it('translates tool_progress SDK message into ToolProgress', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'tool_progress',
            tool_use_id: 'tu-123',
            tool_name: 'Read',
            elapsed_time_seconds: 5
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const progressMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_progress'
      ) as {
        message: {
          kind: string
          toolUseId: string
          toolName: string
          elapsedSeconds: number
        }
      } | undefined
      expect(progressMsg).toBeDefined()
      expect(progressMsg!.message.toolUseId).toBe('tu-123')
      expect(progressMsg!.message.toolName).toBe('Read')
      expect(progressMsg!.message.elapsedSeconds).toBe(5)
    })

    it('passes through undefined when tool_progress fields are missing', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'tool_progress' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // SDK types require these fields; when missing at runtime the translator
      // passes through whatever value is present (undefined).
      const progressMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_progress'
      ) as {
        message: { toolUseId: unknown; toolName: unknown; elapsedSeconds: unknown }
      } | undefined
      expect(progressMsg).toBeDefined()
      expect(progressMsg!.message.toolUseId).toBeUndefined()
      expect(progressMsg!.message.toolName).toBeUndefined()
      expect(progressMsg!.message.elapsedSeconds).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Task update translation
  // -------------------------------------------------------------------------
  describe('task update translation', () => {
    it('translates task_started system subtype into TaskUpdate with started status', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'task_started',
            task_id: 'task-001',
            description: 'Analyzing coverage'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const taskMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'task_update'
      ) as {
        message: {
          kind: string
          taskId: string
          status: string
          description: string
        }
      } | undefined
      expect(taskMsg).toBeDefined()
      expect(taskMsg!.message.status).toBe('started')
      expect(taskMsg!.message.taskId).toBe('task-001')
      expect(taskMsg!.message.description).toBe('Analyzing coverage')
    })

    it('translates task_progress system subtype into TaskUpdate with progress status', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'task_progress',
            task_id: 'task-002',
            description: '50% complete'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const taskMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'task_update'
      ) as {
        message: { status: string; description: string }
      } | undefined
      expect(taskMsg).toBeDefined()
      expect(taskMsg!.message.status).toBe('progress')
      expect(taskMsg!.message.description).toBe('50% complete')
    })

    it('translates task_notification system subtype into TaskUpdate with completed status', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'task_notification',
            task_id: 'task-003',
            summary: 'All tasks done'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const taskMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'task_update'
      ) as {
        message: { status: string; summary: string }
      } | undefined
      expect(taskMsg).toBeDefined()
      expect(taskMsg!.message.status).toBe('completed')
      expect(taskMsg!.message.summary).toBe('All tasks done')
    })

    it('passes undefined taskId when task_id field is missing', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'system',
            subtype: 'task_started',
            id: 'unused-id'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // SDK types require task_id; when missing, the translator passes through
      // whatever is present (undefined) — there is no id-field fallback.
      const taskMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'task_update'
      ) as { message: { taskId: unknown } } | undefined
      expect(taskMsg).toBeDefined()
      expect(taskMsg!.message.taskId).toBeUndefined()
    })

    it('passes undefined taskId when task_id is absent', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'task_started' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const taskMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'task_update'
      ) as { message: { taskId: unknown } } | undefined
      expect(taskMsg).toBeDefined()
      expect(taskMsg!.message.taskId).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Session state change translation
  // -------------------------------------------------------------------------
  describe('session state change translation', () => {
    it('translates session_state_changed with idle state', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'session_state_changed', state: 'idle' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const stateMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'session_state'
      ) as { message: { kind: string; state: string } } | undefined
      expect(stateMsg).toBeDefined()
      expect(stateMsg!.message.state).toBe('idle')
    })

    it('translates session_state_changed with running state', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'session_state_changed', state: 'running' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const stateMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'session_state'
      ) as { message: { state: string } } | undefined
      expect(stateMsg).toBeDefined()
      expect(stateMsg!.message.state).toBe('running')
    })

    it('translates session_state_changed with requires_action state', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'session_state_changed', state: 'requires_action' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const stateMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'session_state'
      ) as { message: { state: string } } | undefined
      expect(stateMsg).toBeDefined()
      expect(stateMsg!.message.state).toBe('requires_action')
    })

    it('passes through session_state_changed with any state value', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'session_state_changed', state: 'unknown_state' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // SDK types define state as a literal union; the translator trusts the
      // SDK and passes through whatever value is present without filtering.
      const stateMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'session_state'
      ) as { message: { state: unknown } } | undefined
      expect(stateMsg).toBeDefined()
      expect(stateMsg!.message.state).toBe('unknown_state')
    })

    it('passes through session_state_changed with non-string state', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'system', subtype: 'session_state_changed', state: 42 }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const stateMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'session_state'
      ) as { message: { state: unknown } } | undefined
      expect(stateMsg).toBeDefined()
      expect(stateMsg!.message.state).toBe(42)
    })
  })

  // -------------------------------------------------------------------------
  // Tool use summary translation
  // -------------------------------------------------------------------------
  describe('tool use summary translation', () => {
    it('translates tool_use_summary with summary field', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'tool_use_summary',
            summary: 'Read 50 lines from index.ts'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const summaryMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_use_summary'
      ) as { message: { kind: string; summary: string } } | undefined
      expect(summaryMsg).toBeDefined()
      expect(summaryMsg!.message.summary).toBe('Read 50 lines from index.ts')
    })

    it('passes through undefined when summary field is absent', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'tool_use_summary' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // SDK types require summary; when missing at runtime the translator
      // passes through whatever value is present (undefined).
      const summaryMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_use_summary'
      ) as { message: { summary: unknown } } | undefined
      expect(summaryMsg).toBeDefined()
      expect(summaryMsg!.message.summary).toBeUndefined()
    })

    it('passes through undefined when both summary and result fields are missing', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield { type: 'tool_use_summary' }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const summaryMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_use_summary'
      ) as { message: { summary: unknown } } | undefined
      expect(summaryMsg).toBeDefined()
      expect(summaryMsg!.message.summary).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Message history cap
  // -------------------------------------------------------------------------
  describe('message history cap', () => {
    it('caps message history at 5000 messages per session', async () => {
      const manager = createManager()

      // Yield enough messages to exceed cap + slack (5500) so the amortized
      // trim fires and clips back to exactly the cap (5000).
      mockQuery.mockImplementation(() => {
        return (async function* () {
          for (let i = 0; i < 5501; i++) {
            yield {
              type: 'system',
              subtype: 'compact_boundary'
            }
          }
        })()
      })

      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 200))

      const messages = manager.getMessages(descriptor.id)
      expect(messages.length).toBeLessThanOrEqual(5000)
    })

    it('evicts oldest messages when cap is exceeded', async () => {
      const manager = createManager()

      // Push past cap + slack (5500) to trigger the trim back to cap (5000).
      mockQuery.mockImplementation(() => {
        return (async function* () {
          for (let i = 0; i < 5501; i++) {
            yield {
              type: 'system',
              subtype: 'compact_boundary'
            }
          }
        })()
      })

      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 200))

      const messages = manager.getMessages(descriptor.id)
      // All messages are compact_boundary, so just verify count is capped
      expect(messages).toHaveLength(5000)
    })

    it('does not store transient tool_progress messages in history', async () => {
      const manager = createManager()

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'tool_progress',
            tool_use_id: 'tu-1',
            tool_name: 'Read',
            elapsed_time_seconds: 3
          }
        })()
      })

      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const messages = manager.getMessages(descriptor.id)
      const progressInHistory = messages.find(
        (m: { kind: string }) => m.kind === 'tool_progress'
      )
      expect(progressInHistory).toBeUndefined()
    })

    it('does not store transient thinking_delta messages in history', async () => {
      const manager = createManager()

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: 'thinking...' }
            }
          }
        })()
      })

      const descriptor = await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const messages = manager.getMessages(descriptor.id)
      const thinkingInHistory = messages.find(
        (m: { kind: string }) => m.kind === 'thinking_delta'
      )
      expect(thinkingInHistory).toBeUndefined()
    })

    it('still emits transient messages via events even though they are not stored', async () => {
      const messageEvents: { message: unknown }[] = []
      const manager = createManager()

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'tool_progress',
            tool_use_id: 'tu-1',
            tool_name: 'Bash',
            elapsed_time_seconds: 10
          }
        })()
      })

      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Event was emitted
      const progressEvent = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'tool_progress'
      )
      expect(progressEvent).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // Content block translation
  // -------------------------------------------------------------------------
  describe('content block translation', () => {
    function createAssistantSdkMessage(content: unknown[]) {
      return {
        type: 'assistant',
        message: {
          content,
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      }
    }

    it('translates text blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            { type: 'text', text: 'Hello world' }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { type: string; text: string }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({ type: 'text', text: 'Hello world' })
    })

    it('translates thinking blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            { type: 'thinking', thinking: 'Deep thought' }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { type: string; thinking: string }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({ type: 'thinking', thinking: 'Deep thought' })
    })

    it('translates redacted_thinking blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            { type: 'redacted_thinking' }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { type: string }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({ type: 'redacted_thinking' })
    })

    it('translates server_tool_use blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            { type: 'server_tool_use', id: 'stu-1', name: 'web_search', input: { query: 'test' } }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: unknown[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({
        type: 'server_tool_use',
        toolUseId: 'stu-1',
        toolName: 'web_search',
        input: { query: 'test' }
      })
    })

    it('translates web_search_tool_result blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            {
              type: 'web_search_tool_result',
              tool_use_id: 'ws-1',
              content: [
                { type: 'web_search_result', title: 'Vitest Docs', url: 'https://vitest.dev' }
              ]
            }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: unknown[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({
        type: 'web_search_tool_result',
        toolUseId: 'ws-1',
        searchQuery: '',
        results: [{ title: 'Vitest Docs', url: 'https://vitest.dev', snippet: '' }]
      })
    })

    it('translates mcp_tool_use blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            {
              type: 'mcp_tool_use',
              id: 'mcp-1',
              server_name: 'github',
              name: 'list_repos',
              input: { org: 'anthropic' }
            }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: unknown[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({
        type: 'mcp_tool_use',
        toolUseId: 'mcp-1',
        serverName: 'github',
        toolName: 'list_repos',
        input: { org: 'anthropic' }
      })
    })

    it('translates mcp_tool_result blocks', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            {
              type: 'mcp_tool_result',
              tool_use_id: 'mcp-1',
              content: 'Found 5 repos',
              is_error: false
            }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: unknown[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0]).toEqual({
        type: 'mcp_tool_result',
        toolUseId: 'mcp-1',
        output: 'Found 5 repos',
        isError: false
      })
    })

    it('translates tool_result blocks as unknown (not a BetaContentBlock type)', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            {
              type: 'tool_result',
              tool_use_id: 'tu-1',
              content: { data: 'structured' },
              is_error: false
            }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // tool_result is not part of BetaContentBlock (it's a request param type),
      // so it hits the catch-all and is emitted as an 'unknown' block.
      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { type: string; rawType: string }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0].type).toBe('unknown')
      expect(msg!.message.content[0].rawType).toBe('tool_result')
    })

    it('translates unknown content block types as UnknownBlock', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            { type: 'future_block_type', foo: 'bar' }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { type: string; rawType: string; data: string }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0].type).toBe('unknown')
      expect(msg!.message.content[0].rawType).toBe('future_block_type')
    })

    it('handles assistant message with null content gracefully', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: null,
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 10, output_tokens: 5 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Should still emit an assistant_message with empty content
      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: unknown[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content).toEqual([])
    })

    it('passes through text block with non-string text field without filtering', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield createAssistantSdkMessage([
            { type: 'text', text: 42 },
            { type: 'text', text: 'valid text' }
          ])
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { type: string; text?: unknown }[] } } | undefined
      expect(msg).toBeDefined()
      // The translator trusts the SDK — it passes both blocks through regardless
      // of the runtime type of the text field.
      expect(msg!.message.content).toHaveLength(2)
      expect(msg!.message.content[0].text).toBe(42)
      expect(msg!.message.content[1].text).toBe('valid text')
    })
  })

  // -------------------------------------------------------------------------
  // Cumulative usage tracking
  // -------------------------------------------------------------------------
  describe('cumulative usage tracking', () => {
    it('accumulates input and output tokens across multiple turns', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Turn 1' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 100, output_tokens: 50 }
            }
          }
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Turn 2' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 200, output_tokens: 100 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // Find the LAST usage message (after turn 2)
      const usageMsgs = messageEvents.filter(
        (e) => (e.message as { kind: string }).kind === 'usage_message'
      ) as { message: { summary: { totalInputTokens: number; totalOutputTokens: number; turnCount: number } } }[]

      expect(usageMsgs.length).toBeGreaterThanOrEqual(2)
      const lastUsage = usageMsgs[usageMsgs.length - 1]
      expect(lastUsage.message.summary.totalInputTokens).toBe(300)
      expect(lastUsage.message.summary.totalOutputTokens).toBe(150)
      expect(lastUsage.message.summary.turnCount).toBe(2)
    })

    it('updates cost from result message', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Response' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 500, output_tokens: 200 }
            }
          }
          yield {
            type: 'result',
            subtype: 'success',
            session_id: '',
            total_cost_usd: 0.025,
            usage: { input_tokens: 500, output_tokens: 200 }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // The result message's usage_message should include the cost
      const usageMsgs = messageEvents.filter(
        (e) => (e.message as { kind: string }).kind === 'usage_message'
      ) as { message: { summary: { totalCostUsd: number | null } } }[]

      const lastUsage = usageMsgs[usageMsgs.length - 1]
      expect(lastUsage.message.summary.totalCostUsd).toBe(0.025)
    })

    it('extracts cache_read_input_tokens and cache_creation_input_tokens', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Cached response' }],
              model: 'claude-sonnet-4-20250514',
              usage: {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 80,
                cache_creation_input_tokens: 20
              }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const usageMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'usage_message'
      ) as {
        message: {
          turnUsage: {
            cacheReadTokens: number | null
            cacheCreationTokens: number | null
          }
        }
      } | undefined
      expect(usageMsg).toBeDefined()
      expect(usageMsg!.message.turnUsage.cacheReadTokens).toBe(80)
      expect(usageMsg!.message.turnUsage.cacheCreationTokens).toBe(20)
    })

    it('returns null cache tokens when not present in usage', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'No cache' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 100, output_tokens: 50 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const usageMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'usage_message'
      ) as {
        message: {
          turnUsage: {
            cacheReadTokens: number | null
            cacheCreationTokens: number | null
          }
        }
      } | undefined
      expect(usageMsg).toBeDefined()
      expect(usageMsg!.message.turnUsage.cacheReadTokens).toBeNull()
      expect(usageMsg!.message.turnUsage.cacheCreationTokens).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Result error code mapping
  // -------------------------------------------------------------------------
  describe('result error code mapping', () => {
    it('maps error_max_budget_usd to rate_limit', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'result',
            is_error: true,
            subtype: 'error_max_budget_usd',
            errors: ['Budget exceeded'],
            session_id: ''
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { code: string; recoverable: boolean } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.code).toBe('rate_limit')
      expect(errorMsg!.message.recoverable).toBe(false)
    })

    it('maps unknown error subtypes to unknown code', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'result',
            is_error: true,
            subtype: 'error_something_new',
            result: 'New error type'
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { code: string } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.code).toBe('unknown')
    })

    it('emits error for result with error_ prefix subtype even without is_error', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            errors: ['Execution failed'],
            session_id: ''
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { code: string } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.code).toBe('tool_error')
    })

    it('uses default message when result field is missing', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'result',
            is_error: true,
            subtype: 'error_max_turns',
            errors: [],
            session_id: ''
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const errorMsg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'error_message'
      ) as { message: { message: string } } | undefined
      expect(errorMsg).toBeDefined()
      expect(errorMsg!.message.message).toBe('Session ended with an error')
    })
  })

  // -------------------------------------------------------------------------
  // Tool approval — full chain
  // -------------------------------------------------------------------------
  describe('tool approval — full chain', () => {
    it('emits tool-approval event with correct payload for write tools', async () => {
      const manager = createManager()
      const approvalEvents: unknown[] = []

      const descriptor = await createDefaultSession(manager)
      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      manager.on(
        'tool-approval',
        (req: {
          sessionId: string
          toolUseId: string
          toolName: string
          input: Record<string, unknown>
          title?: string
          description?: string
          reason?: string
        }) => {
          approvalEvents.push({
            sessionId: req.sessionId,
            toolUseId: req.toolUseId,
            toolName: req.toolName,
            input: req.input,
            title: req.title,
            description: req.description,
            reason: req.reason
          })
          // Approve immediately for test
          manager.handleToolApprovalResponse(req.sessionId, req.toolUseId, 'approve', null)
        }
      )

      await canUseTool(
        'Bash',
        { command: 'rm -rf /' },
        { toolUseID: 'bash-1', title: 'Run command', description: 'Dangerous command', decisionReason: 'bash access' }
      )

      expect(approvalEvents).toHaveLength(1)
      const event = approvalEvents[0] as Record<string, unknown>
      expect(event.sessionId).toBe(descriptor.id)
      expect(event.toolUseId).toBe('bash-1')
      expect(event.toolName).toBe('Bash')
      expect(event.input).toEqual({ command: 'rm -rf /' })
      expect(event.title).toBe('Run command')
      expect(event.description).toBe('Dangerous command')
      expect(event.reason).toBe('bash access')

      manager.destroy(descriptor.id)
    })


    it('resolves with deny and includes user message when denied', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)
      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      manager.on(
        'tool-approval',
        (req: { sessionId: string; toolUseId: string }) => {
          manager.handleToolApprovalResponse(req.sessionId, req.toolUseId, 'deny', 'Not safe')
        }
      )

      const result = await canUseTool('Write', {}, { toolUseId: 'w1' })
      expect(result.behavior).toBe('deny')
      expect(result.message).toContain('Not safe')

      manager.destroy(descriptor.id)
    })

    it('cleans up pending approvals when session is destroyed', async () => {
      const manager = createManager()
      const descriptor = await createDefaultSession(manager)
      const callArgs = mockQuery.mock.calls[0][0]
      const canUseTool = callArgs.options.canUseTool

      // Start an approval but don't resolve it
      const approvalPromise = canUseTool('Write', {}, { toolUseId: 'w-orphan' })

      // Destroy the session
      manager.destroy(descriptor.id)

      // The pending approval should be cleaned up — handle a response
      // for the orphaned toolUseId: should just warn, not crash
      manager.handleToolApprovalResponse(descriptor.id, 'w-orphan', 'approve', null)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No pending approval found for key',
        expect.objectContaining({ toolUseId: 'w-orphan' })
      )

      // The original approval promise should resolve to a deny so the SDK
      // can tear down cleanly without leaking the pending tool use.
      const result = await approvalPromise
      expect(result.behavior).toBe('deny')
    })
  })

  // -------------------------------------------------------------------------
  // web_search_tool_result edge cases
  // -------------------------------------------------------------------------
  describe('web_search_tool_result edge cases', () => {
    it('sets snippet to empty string (BetaWebSearchResultBlock has no snippet field)', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'web_search_tool_result',
                  tool_use_id: 'ws-2',
                  content: [
                    { type: 'web_search_result', title: 'Result', url: 'https://example.com' }
                  ]
                }
              ],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 10, output_tokens: 5 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      // BetaWebSearchResultBlock has no snippet/description field;
      // the translator maps snippet to '' for all results.
      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { results: { snippet: string }[] }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0].results[0].snippet).toBe('')
    })

    it('uses tool_use_id as fallback when id is missing', async () => {
      const messageEvents: { message: unknown }[] = []

      mockQuery.mockImplementation(() => {
        return (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'web_search_tool_result',
                  tool_use_id: 'ws-fallback',
                  search_query: 'query',
                  results: []
                }
              ],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 10, output_tokens: 5 }
            }
          }
        })()
      })

      const manager = createManager()
      manager.on('message', (_sid: string, message: unknown) => {
        messageEvents.push({ message })
      })

      await manager.create(VALID_CWD)
      await new Promise((r) => setTimeout(r, 50))

      const msg = messageEvents.find(
        (e) => (e.message as { kind: string }).kind === 'assistant_message'
      ) as { message: { content: { toolUseId: string }[] } } | undefined
      expect(msg).toBeDefined()
      expect(msg!.message.content[0].toolUseId).toBe('ws-fallback')
    })
  })

  // -------------------------------------------------------------------------
  // sendInterAgentMessage()
  // -------------------------------------------------------------------------
  describe('sendInterAgentMessage()', () => {
    it('emits a "message" event to the target session with correct shape', async () => {
      const manager = createManager()
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-from' })
      const to = await createDefaultSession(manager, { cwd: '/Users/test/iam-to' })

      const interAgentEvents: { sessionId: string; message: Record<string, unknown> }[] = []
      manager.on('message', (sessionId: string, message: unknown) => {
        const m = message as { kind: string }
        if (m.kind === 'inter_agent_message') {
          interAgentEvents.push({ sessionId, message: message as Record<string, unknown> })
        }
      })

      const before = Date.now()
      manager.sendInterAgentMessage({
        fromSessionId: from.id,
        toSessionId: to.id,
        content: 'ping from A'
      })
      const after = Date.now()

      expect(interAgentEvents).toHaveLength(1)
      const evt = interAgentEvents[0]
      expect(evt.sessionId).toBe(to.id)
      expect(evt.message.kind).toBe('inter_agent_message')
      expect(evt.message.sessionId).toBe(to.id)
      expect(evt.message.fromSessionId).toBe(from.id)
      expect(evt.message.content).toBe('ping from A')
      expect(typeof evt.message.timestamp).toBe('number')
      expect(evt.message.timestamp as number).toBeGreaterThanOrEqual(before)
      expect(evt.message.timestamp as number).toBeLessThanOrEqual(after)

      manager.destroy(from.id)
      manager.destroy(to.id)
    })

    it('does not include a fromSessionName field on the emitted message', async () => {
      const manager = createManager()
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-from2' })
      const to = await createDefaultSession(manager, { cwd: '/Users/test/iam-to2' })

      const emitted: Record<string, unknown>[] = []
      manager.on('message', (_sid: string, message: unknown) => {
        const m = message as { kind: string }
        if (m.kind === 'inter_agent_message') {
          emitted.push(message as Record<string, unknown>)
        }
      })

      manager.sendInterAgentMessage({
        fromSessionId: from.id,
        toSessionId: to.id,
        content: 'hello'
      })

      expect(emitted).toHaveLength(1)
      expect(emitted[0]).not.toHaveProperty('fromSessionName')

      manager.destroy(from.id)
      manager.destroy(to.id)
    })

    it('appends the message to the target session history', async () => {
      const manager = createManager()
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-hist-from' })
      const to = await createDefaultSession(manager, { cwd: '/Users/test/iam-hist-to' })

      manager.sendInterAgentMessage({
        fromSessionId: from.id,
        toSessionId: to.id,
        content: 'persisted in target'
      })

      const targetMessages = manager.getMessages(to.id)
      const interAgent = targetMessages.filter(
        (m) => (m as { kind: string }).kind === 'inter_agent_message'
      ) as { kind: string; sessionId: string; fromSessionId: string; content: string }[]
      expect(interAgent).toHaveLength(1)
      expect(interAgent[0].sessionId).toBe(to.id)
      expect(interAgent[0].fromSessionId).toBe(from.id)
      expect(interAgent[0].content).toBe('persisted in target')

      manager.destroy(from.id)
      manager.destroy(to.id)
    })

    it('does NOT append the message to the sender history (v1 limitation)', async () => {
      const manager = createManager()
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-sender-from' })
      const to = await createDefaultSession(manager, { cwd: '/Users/test/iam-sender-to' })

      manager.sendInterAgentMessage({
        fromSessionId: from.id,
        toSessionId: to.id,
        content: 'not in sender history'
      })

      const senderMessages = manager.getMessages(from.id)
      const interAgent = senderMessages.filter(
        (m) => (m as { kind: string }).kind === 'inter_agent_message'
      )
      expect(interAgent).toHaveLength(0)

      manager.destroy(from.id)
      manager.destroy(to.id)
    })

    it('throws when fromSessionId === toSessionId (self-send)', async () => {
      const manager = createManager()
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-self' })

      expect(() =>
        manager.sendInterAgentMessage({
          fromSessionId: from.id,
          toSessionId: from.id,
          content: 'self'
        })
      ).toThrow(/self/i)

      manager.destroy(from.id)
    })

    it('throws SessionNotFoundError when fromSessionId does not exist', async () => {
      const manager = createManager()
      const to = await createDefaultSession(manager, { cwd: '/Users/test/iam-nofrom' })

      expect(() =>
        manager.sendInterAgentMessage({
          fromSessionId: TEST_UUIDS.session,
          toSessionId: to.id,
          content: 'hi'
        })
      ).toThrow(SessionNotFoundError)

      manager.destroy(to.id)
    })

    it('throws SessionNotFoundError when toSessionId does not exist', async () => {
      const manager = createManager()
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-noto' })

      expect(() =>
        manager.sendInterAgentMessage({
          fromSessionId: from.id,
          toSessionId: TEST_UUIDS.otherSession,
          content: 'hi'
        })
      ).toThrow(SessionNotFoundError)

      manager.destroy(from.id)
    })

    it('throws when the target session is in "exited" state', async () => {
      const manager = createManager()
      // Sender: long-running (default mock).
      const from = await createDefaultSession(manager, { cwd: '/Users/test/iam-exit-from' })

      // Target: exits immediately — status flips to 'exited' but remains in map.
      mockQuery.mockImplementationOnce(() => {
        return (async function* () {
          // empty — ends immediately
        })()
      })
      const to = await manager.create('/Users/test/iam-exit-to')
      // Wait for the SDK loop to finish and handleSessionExit to run.
      await vi.waitUntil(
        () => manager.list().find((s) => s.id === to.id)?.status === 'exited',
        { timeout: 500 }
      )

      expect(() =>
        manager.sendInterAgentMessage({
          fromSessionId: from.id,
          toSessionId: to.id,
          content: 'into the void'
        })
      ).toThrow(/not running/i)

      manager.destroy(from.id)
      manager.destroy(to.id)
    })

    it('throws when the sender session is in "exited" state', async () => {
      const manager = createManager()

      // Sender: exits immediately.
      mockQuery.mockImplementationOnce(() => {
        return (async function* () {
          // empty — ends immediately
        })()
      })
      const from = await manager.create('/Users/test/iam-exit-from2')
      await vi.waitUntil(
        () => manager.list().find((s) => s.id === from.id)?.status === 'exited',
        { timeout: 500 }
      )

      // Target: long-running.
      const to = await createDefaultSession(manager, { cwd: '/Users/test/iam-exit-to2' })

      expect(() =>
        manager.sendInterAgentMessage({
          fromSessionId: from.id,
          toSessionId: to.id,
          content: 'from a ghost'
        })
      ).toThrow(/not running/i)

      manager.destroy(from.id)
      manager.destroy(to.id)
    })
  })
})
