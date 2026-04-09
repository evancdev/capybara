import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { SessionNotFoundError, UnknownSlashCommandError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// Focused tests for SessionService.setPermissionMode / runCommand.
// Kept in a separate file so the main session.test.ts stays scannable.
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  // Minimal stand-ins for inter-agent MCP wiring inside SessionService.create.
  createSdkMcpServer: (opts: { name: string }) => ({
    type: 'sdk' as const,
    name: opts.name,
    instance: {}
  }),
  tool: (
    name: string,
    description: string,
    inputSchema: unknown,
    handler: unknown
  ) => ({ name, description, inputSchema, handler })
}))

const { SessionService } = await import('@/main/services/session')
const { ClaudeConnection } = await import('@/main/claude/connection')
const claudeHistory = await import('@/main/claude/history')
import type { InterAgentRouter } from '@/main/services/inter-agent-router'
import type { MainSlashCommandRegistry } from '@/main/services/slash-commands'
import type { CapybaraMessage } from '@/shared/types/messages'

function createStubRouter(): InterAgentRouter {
  return {
    handleToolCall: vi.fn()
  } as unknown as InterAgentRouter
}

const VALID_CWD = '/Users/test/project'

function makeService(
  mainCommands: MainSlashCommandRegistry = {}
): InstanceType<typeof SessionService> {
  const service = new SessionService({
    connectionFactory: (ctx) => new ClaudeConnection(ctx),
    conversations: {
      listConversations: claudeHistory.listConversations,
      loadConversationMessages: claudeHistory.loadConversationMessages,
      renameConversation: claudeHistory.renameConversation
    },
    mainCommands
  })
  service.setInterAgentRouter(createStubRouter())
  return service
}

describe('SessionService — setPermissionMode / runCommand', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Query that hangs until aborted, so sessions stay "running" for the tests.
    mockQuery.mockImplementation(
      ({ abortController }: { abortController?: AbortController } = {}) => {
        return (async function* () {
          await new Promise((_, reject) => {
            abortController?.signal.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          })
        })()
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // setPermissionMode
  // -------------------------------------------------------------------------
  describe('setPermissionMode()', () => {
    it('updates the session descriptor and emits metadata_updated', async () => {
      const service = makeService()
      const emitted: CapybaraMessage[] = []
      service.on('message', (_sid: string, msg: CapybaraMessage) => {
        emitted.push(msg)
      })

      const descriptor = await service.create(VALID_CWD)
      emitted.length = 0 // ignore any startup churn

      service.setPermissionMode(descriptor.id, 'plan')

      // The session list should now report the new mode
      const listed = service.list().find((s) => s.id === descriptor.id)
      expect(listed?.permissionMode).toBe('plan')

      // A metadata_updated event should have been emitted carrying the mode
      const meta = emitted.find((m) => m.kind === 'metadata_updated')
      expect(meta).toBeDefined()
      expect(
        (meta!.metadata as Record<string, unknown>).permissionMode
      ).toBe('plan')

      service.destroy(descriptor.id)
    })

    it('delegates to connection.setPermissionMode', async () => {
      const service = makeService()
      const descriptor = await service.create(VALID_CWD)

      // Spy on the underlying connection
      const internal = (
        service as unknown as {
          sessions: Map<
            string,
            { connection: { setPermissionMode: (m: string) => void } }
          >
        }
      ).sessions.get(descriptor.id)!
      const spy = vi.spyOn(internal.connection, 'setPermissionMode')

      service.setPermissionMode(descriptor.id, 'acceptEdits')

      expect(spy).toHaveBeenCalledWith('acceptEdits')

      service.destroy(descriptor.id)
    })

    it('throws SessionNotFoundError for an unknown session', () => {
      const service = makeService()
      expect(() =>
        service.setPermissionMode(
          '00000000-0000-0000-0000-000000000000',
          'plan'
        )
      ).toThrow(SessionNotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // runCommand
  // -------------------------------------------------------------------------
  describe('runCommand()', () => {
    it('dispatches to the registered handler with a scoped context', async () => {
      const handler = vi.fn().mockResolvedValue({})
      const registry: MainSlashCommandRegistry = {
        ping: { name: 'ping', handler }
      }
      const service = makeService(registry)
      const descriptor = await service.create(VALID_CWD)

      await service.runCommand(descriptor.id, 'ping', ['arg1'])

      expect(handler).toHaveBeenCalledTimes(1)
      const ctx = handler.mock.calls[0][0] as {
        sessionId: string
        cwd: string
        args: string[]
        sessionService: unknown
        connection: unknown
      }
      expect(ctx.sessionId).toBe(descriptor.id)
      expect(ctx.cwd).toBe(VALID_CWD)
      expect(ctx.args).toEqual(['arg1'])
      expect(ctx.sessionService).toBe(service)
      expect(ctx.connection).toBeDefined()

      service.destroy(descriptor.id)
    })

    it('matches command names case-insensitively', async () => {
      const handler = vi.fn().mockResolvedValue({})
      const service = makeService({ ping: { name: 'ping', handler } })
      const descriptor = await service.create(VALID_CWD)

      await service.runCommand(descriptor.id, 'PING', [])

      expect(handler).toHaveBeenCalled()

      service.destroy(descriptor.id)
    })

    it('throws UnknownSlashCommandError for an unregistered command', async () => {
      const service = makeService({})
      const descriptor = await service.create(VALID_CWD)

      await expect(
        service.runCommand(descriptor.id, 'nosuch', [])
      ).rejects.toBeInstanceOf(UnknownSlashCommandError)

      service.destroy(descriptor.id)
    })

    it('throws SessionNotFoundError for an unknown session id', async () => {
      const handler = vi.fn().mockResolvedValue({})
      const service = makeService({ ping: { name: 'ping', handler } })

      await expect(
        service.runCommand(
          '00000000-0000-0000-0000-000000000000',
          'ping',
          []
        )
      ).rejects.toBeInstanceOf(SessionNotFoundError)

      expect(handler).not.toHaveBeenCalled()
    })

  })

  // -------------------------------------------------------------------------
  // setPermissionMode emits metadata_updated — regression test
  // -------------------------------------------------------------------------
  describe('setPermissionMode + metadata_updated flow', () => {
    it('emitted metadata_updated includes the new permissionMode AND live metadata', async () => {
      const service = makeService()
      const emitted: CapybaraMessage[] = []
      service.on('message', (_sid: string, msg: CapybaraMessage) => {
        emitted.push(msg)
      })

      const descriptor = await service.create(VALID_CWD)
      emitted.length = 0

      service.setPermissionMode(descriptor.id, 'acceptEdits')

      const meta = emitted.find((m) => m.kind === 'metadata_updated')
      expect(meta).toBeDefined()
      expect(meta).toMatchObject({
        kind: 'metadata_updated',
        sessionId: descriptor.id,
        metadata: { permissionMode: 'acceptEdits' }
      })

      service.destroy(descriptor.id)
    })
  })

  // -------------------------------------------------------------------------
  // Bug regression: /model handler now emits metadata_updated (fix verified)
  // -------------------------------------------------------------------------
  describe('runCommand /model — metadata_updated emission', () => {
    it('emits metadata_updated after /model when using MAIN_COMMANDS registry', async () => {
      // Regression test: the real MAIN_COMMANDS.model handler calls
      // ctx.sessionService.notifyMetadataUpdated(ctx.sessionId) after
      // ctx.connection.setModel(name). Verify the event reaches listeners.
      const { MAIN_COMMANDS } = await import('@/main/services/slash-commands')
      const service = makeService(MAIN_COMMANDS)
      const emitted: CapybaraMessage[] = []
      service.on('message', (_sid: string, msg: CapybaraMessage) => {
        emitted.push(msg)
      })

      const descriptor = await service.create(VALID_CWD)
      emitted.length = 0

      await service.runCommand(descriptor.id, 'model', ['claude-haiku'])

      const meta = emitted.find((m) => m.kind === 'metadata_updated')
      expect(meta).toBeDefined()
      expect(meta).toMatchObject({
        kind: 'metadata_updated',
        sessionId: descriptor.id,
        metadata: { model: 'claude-haiku' }
      })

      service.destroy(descriptor.id)
    })

    it('a handler that does not call notifyMetadataUpdated does not emit metadata_updated', async () => {
      // Counterpart: a handler that only calls connection.setModel without
      // notifyMetadataUpdated will NOT emit. This documents the contract.
      const modelCmd = {
        name: 'model',
        handler: vi.fn().mockImplementation((ctx: { connection: { setModel: (m: string) => void } }) => {
          ctx.connection.setModel('claude-haiku')
          return Promise.resolve({})
        })
      }
      const service = makeService({ model: modelCmd })
      const emitted: CapybaraMessage[] = []
      service.on('message', (_sid: string, msg: CapybaraMessage) => {
        emitted.push(msg)
      })

      const descriptor = await service.create(VALID_CWD)
      emitted.length = 0

      await service.runCommand(descriptor.id, 'model', ['claude-haiku'])

      const meta = emitted.find((m) => m.kind === 'metadata_updated')
      expect(meta).toBeUndefined()

      service.destroy(descriptor.id)
    })
  })
})
