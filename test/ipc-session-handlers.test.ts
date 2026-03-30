import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionNotFoundError } from '@/main/lib/errors'
import type { ValidateCwdDeps } from '@/main/types/ipc'

const handleMap = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, handler)
    }),
    on: vi.fn()
  }
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({
  logger: mockLogger
}))

const mockStatAsync = vi.fn()
const mockHomedir = vi.fn()
const mockCwdDeps: ValidateCwdDeps = {
  homedir: () => mockHomedir(),
  stat: (p) => mockStatAsync(p),
  resolve: path.resolve,
  sep: path.sep
}

const { registerSessionHandlers } = await import(
  '@/main/controllers/ipc/session'
)
const { IPC } = await import('@/shared/types/constants')

function createMockSessionManager() {
  return {
    create: vi.fn().mockReturnValue({
      id: 'test-uuid',
      pid: 12345,
      status: 'running',
      exitCode: null,
      command: 'claude',
      cwd: '/Users/test/project',
      name: 'Agent 1',
      createdAt: Date.now(),
    }),
    destroy: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    rename: vi.fn().mockReturnValue({
      id: 'test-uuid',
      pid: 12345,
      status: 'running',
      exitCode: null,
      command: 'claude',
      cwd: '/Users/test/project',
      name: 'Renamed',
      createdAt: Date.now(),
    }),
    resize: vi.fn(),
    write: vi.fn(),
    snapshotAndClearBuffer: vi.fn().mockReturnValue(''),
    destroyAll: vi.fn(),
    getBuffer: vi.fn().mockReturnValue('')
  }
}

function createMockConversationHistoryService() {
  return {
    listConversations: vi.fn().mockResolvedValue([])
  }
}

function createMockEvent(senderId = 1) {
  return { sender: { id: senderId } } as unknown as Electron.IpcMainInvokeEvent
}

function noopValidateSender(_event: unknown): void {}

const sendToRendererCalls: unknown[][] = []
function mockSendToRenderer(...args: unknown[]): void {
  sendToRendererCalls.push(args)
}

describe('IPC Session Handlers', () => {
  let sessionManager: ReturnType<typeof createMockSessionManager>
  let conversationHistoryService: ReturnType<typeof createMockConversationHistoryService>

  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
    sendToRendererCalls.length = 0
    sessionManager = createMockSessionManager()
    conversationHistoryService = createMockConversationHistoryService()
    mockHomedir.mockReturnValue('/Users/test')
    mockStatAsync.mockResolvedValue({ isDirectory: () => true })

    registerSessionHandlers(
      sessionManager as never,
      conversationHistoryService as never,
      noopValidateSender,
      mockSendToRenderer,
      mockCwdDeps
    )
  })

  describe('safeHandler', () => {
    it('returns "Invalid input" error for ZodError', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      await expect(handler(event, 'not-a-uuid')).rejects.toThrow('Invalid input')
    })

    it('returns "Session not found" error for SessionNotFoundError', async () => {
      sessionManager.destroy.mockImplementation(() => {
        throw new SessionNotFoundError('missing-id')
      })

      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid)).rejects.toThrow('Session not found')
    })

    it('returns "Internal error" for unknown errors', async () => {
      sessionManager.list.mockImplementation(() => {
        throw new TypeError('unexpected')
      })

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })

    it('logs unknown errors via logger.error', async () => {
      const origError = new TypeError('something broke')
      sessionManager.list.mockImplementation(() => {
        throw origError
      })

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      try {
        await handler(event)
      } catch { /* expected */ }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error in IPC handler on session:list',
        { error: origError }
      )
    })

    it('does not log ZodError via logger.error', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      try {
        await handler(event, 'not-a-uuid')
      } catch { /* expected */ }

      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('does not log SessionNotFoundError via logger.error', async () => {
      sessionManager.destroy.mockImplementation(() => {
        throw new SessionNotFoundError('gone')
      })

      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      try {
        await handler(event, '550e8400-e29b-41d4-a716-446655440000')
      } catch { /* expected */ }

      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('returns CwdValidationError message (not "Internal error")', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '/etc' })).rejects.toThrow('Invalid directory')
    })

    it('does not log CwdValidationError via logger.error', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      try {
        await handler(event, { cwd: '/etc' })
      } catch { /* expected */ }

      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('logs ZodError via logger.warn', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      try {
        await handler(event, 'not-a-uuid')
      } catch { /* expected */ }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('IPC validation failed'),
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('logs SessionNotFoundError via logger.warn', async () => {
      sessionManager.destroy.mockImplementation(() => {
        throw new SessionNotFoundError('gone')
      })

      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      try {
        await handler(event, '550e8400-e29b-41d4-a716-446655440000')
      } catch { /* expected */ }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('IPC session not found'),
        expect.objectContaining({ error: expect.any(String) })
      )
    })

    it('logs CwdValidationError via logger.warn', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      try {
        await handler(event, { cwd: '/etc' })
      } catch { /* expected */ }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('IPC cwd validation failed'),
        expect.objectContaining({ error: expect.any(String) })
      )
    })
  })

  describe('validateCwd', () => {
    it('accepts a path directly under $HOME', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('accepts $HOME itself as cwd', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('rejects paths outside $HOME', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '/etc' })).rejects.toThrow('Invalid directory')
    })

    it('rejects /tmp as outside $HOME', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '/tmp' })).rejects.toThrow('Invalid directory')
    })

    it('rejects nonexistent directories', async () => {
      mockStatAsync.mockRejectedValue(
        new Error('ENOENT: no such file or directory')
      )

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/nonexistent' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects path traversal attempts', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/../../etc' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects home directory prefix attacks', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/testevil/project' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects paths that exist but are not directories', async () => {
      mockStatAsync.mockResolvedValue({ isDirectory: () => false })

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/somefile.txt' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects short home directory prefix attack (/rootkit when home is /root)', async () => {
      mockHomedir.mockReturnValue('/root')

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/rootkit/exploit' })
      ).rejects.toThrow('Invalid directory')
    })

    it('accepts paths with spaces', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/My Projects/app' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('accepts paths with trailing slash', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project/' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('accepts paths with consecutive slashes', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test//project' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('accepts dot-prefixed subdirectory (.ssh)', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/.ssh' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('accepts dot-prefixed nested subdirectory', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/.local/share/project' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('rejects root path /', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/' })
      ).rejects.toThrow('Invalid directory')
    })

    it('accepts deeply nested path under $HOME', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/a/b/c/d/e/f/g/project' })
      expect(sessionManager.create).toHaveBeenCalled()
    })
  })

  describe('handler registration', () => {
    it('registers all expected session IPC channels', () => {
      expect(handleMap.has(IPC.SESSION_CREATE)).toBe(true)
      expect(handleMap.has(IPC.SESSION_DESTROY)).toBe(true)
      expect(handleMap.has(IPC.SESSION_LIST)).toBe(true)
      expect(handleMap.has(IPC.SESSION_RENAME)).toBe(true)
      expect(handleMap.has(IPC.SESSION_RESIZE)).toBe(true)
      expect(handleMap.has(IPC.SESSION_REPLAY)).toBe(true)
      expect(handleMap.has(IPC.SESSION_GET_HISTORY)).toBe(true)
      expect(handleMap.has(IPC.SESSION_LIST_CONVERSATIONS)).toBe(true)
    })
  })

  describe('sender validation', () => {
    it('rejects calls when validateSender throws', async () => {
      handleMap.clear()
      const throwingSender = () => {
        throw new Error('[IPC] sender is not the main window')
      }
      registerSessionHandlers(
        sessionManager as never,
        conversationHistoryService as never,
        throwingSender,
        mockSendToRenderer,
        mockCwdDeps
      )

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })
  })

  describe('SESSION_CREATE', () => {
    it('passes validated cwd and callbacks to sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project', name: 'My Agent' })

      expect(sessionManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: path.resolve('/Users/test/project'),
          name: 'My Agent'
        }),
        expect.any(Function),
        expect.any(Function)
      )
    })

    it('rejects missing cwd', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, {})).rejects.toThrow('Invalid input')
    })

    it('passes valid resumeConversationId through to sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()
      const resumeId = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, { cwd: '/Users/test/project', resumeConversationId: resumeId })

      expect(sessionManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: path.resolve('/Users/test/project'),
          resumeConversationId: resumeId
        }),
        expect.any(Function),
        expect.any(Function)
      )
    })

    it('rejects invalid resumeConversationId', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/project', resumeConversationId: 'not-a-uuid' })
      ).rejects.toThrow('Invalid input')
    })

    it('does not pass excess properties to sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project', malicious: 'payload' })

      const createCallArgs = sessionManager.create.mock.calls[0][0]
      expect(createCallArgs).not.toHaveProperty('malicious')
    })

    it('returns the session object from sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      const result = await handler(event, { cwd: '/Users/test/project' })

      expect(result).toEqual(
        expect.objectContaining({
          id: 'test-uuid',
          pid: 12345,
          status: 'running'
        })
      )
    })

    it('rejects empty cwd string', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '' })).rejects.toThrow('Invalid input')
    })

    it('rejects empty name string (min 1)', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/project', name: '' })
      ).rejects.toThrow('Invalid input')
    })

    it('accepts name at exactly max length (40 chars)', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project', name: 'a'.repeat(40) })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('rejects name exceeding max length (41 chars)', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/project', name: 'a'.repeat(41) })
      ).rejects.toThrow('Invalid input')
    })

    it('routes onOutput callback through sendToRenderer with correct channel', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project' })

      const onOutput = sessionManager.create.mock.calls[0][1] as (id: string, data: string) => void
      sendToRendererCalls.length = 0
      onOutput('test-uuid', 'hello world')

      expect(sendToRendererCalls).toEqual([
        [IPC.TERMINAL_OUTPUT, 'test-uuid', 'hello world']
      ])
    })

    it('routes onExit callback through sendToRenderer with correct channel', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project' })

      const onExit = sessionManager.create.mock.calls[0][2] as (id: string, exitCode: number) => void
      sendToRendererCalls.length = 0
      onExit('test-uuid', 0)

      expect(sendToRendererCalls).toEqual([
        [IPC.SESSION_EXITED, 'test-uuid', 0]
      ])
    })

  })

  describe('SESSION_DESTROY', () => {
    it('calls sessionManager.destroy with parsed UUID', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, validUuid)

      expect(sessionManager.destroy).toHaveBeenCalledWith(validUuid)
    })

    it('rejects non-UUID session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      await expect(handler(event, 'not-a-uuid')).rejects.toThrow('Invalid input')
    })

    it('rejects missing session ID (undefined)', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      await expect(handler(event, undefined)).rejects.toThrow('Invalid input')
    })

    it('rejects null session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      await expect(handler(event, null)).rejects.toThrow('Invalid input')
    })

    it('rejects numeric session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()

      await expect(handler(event, 12345)).rejects.toThrow('Invalid input')
    })
  })

  describe('SESSION_LIST', () => {
    it('returns the list from sessionManager', async () => {
      const mockList = [{ id: 'abc', name: 'Agent 1' }]
      sessionManager.list.mockReturnValue(mockList)

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBe(mockList)
    })

    it('returns empty array when no sessions exist', async () => {
      sessionManager.list.mockReturnValue([])

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toEqual([])
    })
  })

  describe('SESSION_RESIZE', () => {
    it('calls sessionManager.resize with parsed inputs', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, { sessionId: validUuid, cols: 120, rows: 40 })

      expect(sessionManager.resize).toHaveBeenCalledWith(validUuid, 120, 40)
    })

    it('rejects missing cols', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(
        handler(event, { sessionId: validUuid, rows: 24 })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects zero dimensions', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(
        handler(event, { sessionId: validUuid, cols: 0, rows: 0 })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects negative dimensions', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(
        handler(event, { sessionId: validUuid, cols: -1, rows: -1 })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects dimensions above upper bounds', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(
        handler(event, { sessionId: validUuid, cols: 501, rows: 201 })
      ).rejects.toThrow('Invalid input')
    })

    it('accepts minimum valid dimensions (cols=1, rows=1)', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, { sessionId: validUuid, cols: 1, rows: 1 })

      expect(sessionManager.resize).toHaveBeenCalledWith(validUuid, 1, 1)
    })

    it('accepts maximum valid dimensions (cols=500, rows=200)', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, { sessionId: validUuid, cols: 500, rows: 200 })

      expect(sessionManager.resize).toHaveBeenCalledWith(validUuid, 500, 200)
    })

    it('rejects non-integer (float) dimensions', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(
        handler(event, { sessionId: validUuid, cols: 80.5, rows: 24.5 })
      ).rejects.toThrow('Invalid input')
    })
  })

  describe('SESSION_RENAME', () => {
    it('calls sessionManager.rename with parsed inputs', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, validUuid, 'New Name')

      expect(sessionManager.rename).toHaveBeenCalledWith(
        validUuid,
        'New Name'
      )
    })
    it('rejects non-UUID session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()

      await expect(handler(event, 'bad-id', 'Name')).rejects.toThrow('Invalid input')
    })

    it('rejects name exceeding max length', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(
        handler(event, validUuid, 'a'.repeat(41))
      ).rejects.toThrow('Invalid input')
    })

    it('accepts empty string name (no min constraint in RenameSchema)', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, validUuid, '')

      expect(sessionManager.rename).toHaveBeenCalledWith(validUuid, '')
    })

    it('rejects missing name argument (undefined)', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid, undefined)).rejects.toThrow('Invalid input')
    })

    it('accepts name at exactly max length (40 chars)', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, validUuid, 'a'.repeat(40))

      expect(sessionManager.rename).toHaveBeenCalledWith(validUuid, 'a'.repeat(40))
    })

    it('returns the renamed session object', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      const result = await handler(event, validUuid, 'New Name')

      expect(result).toEqual(
        expect.objectContaining({
          id: 'test-uuid',
          name: 'Renamed'
        })
      )
    })
  })

  describe('SESSION_REPLAY', () => {
    it('returns snapshot from sessionManager', async () => {
      sessionManager.snapshotAndClearBuffer.mockReturnValue('buffered output')
      const handler = handleMap.get(IPC.SESSION_REPLAY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      const result = await handler(event, validUuid)

      expect(result).toBe('buffered output')
    })

    it('rejects non-UUID session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_REPLAY)!
      const event = createMockEvent()

      await expect(handler(event, 'not-a-uuid')).rejects.toThrow('Invalid input')
    })

    it('returns "Session not found" for missing session', async () => {
      sessionManager.snapshotAndClearBuffer.mockImplementation(() => {
        throw new SessionNotFoundError('gone')
      })

      const handler = handleMap.get(IPC.SESSION_REPLAY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid)).rejects.toThrow('Session not found')
    })

    it('rejects missing session ID (undefined)', async () => {
      const handler = handleMap.get(IPC.SESSION_REPLAY)!
      const event = createMockEvent()

      await expect(handler(event, undefined)).rejects.toThrow('Invalid input')
    })
  })

  describe('SESSION_GET_HISTORY', () => {
    it('returns buffer content from sessionManager.getBuffer', async () => {
      sessionManager.getBuffer.mockReturnValue('history data chunk1chunk2')
      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      const result = await handler(event, validUuid)

      expect(result).toBe('history data chunk1chunk2')
      expect(sessionManager.getBuffer).toHaveBeenCalledWith(validUuid)
    })

    it('returns empty string when buffer is empty', async () => {
      sessionManager.getBuffer.mockReturnValue('')
      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      const result = await handler(event, validUuid)

      expect(result).toBe('')
    })

    it('rejects non-UUID session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()

      await expect(handler(event, 'not-a-uuid')).rejects.toThrow('Invalid input')
    })

    it('rejects missing session ID argument', async () => {
      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()

      await expect(handler(event, undefined)).rejects.toThrow('Invalid input')
    })

    it('rejects numeric session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()

      await expect(handler(event, 12345)).rejects.toThrow('Invalid input')
    })

    it('returns "Session not found" for missing session', async () => {
      sessionManager.getBuffer.mockImplementation(() => {
        throw new SessionNotFoundError('gone')
      })

      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid)).rejects.toThrow('Session not found')
    })

    it('returns "Internal error" when getBuffer throws unexpected error', async () => {
      sessionManager.getBuffer.mockImplementation(() => {
        throw new TypeError('something unexpected')
      })

      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid)).rejects.toThrow('Internal error')
    })

    it('does not clear the buffer (unlike SESSION_REPLAY)', async () => {
      sessionManager.getBuffer.mockReturnValue('persistent data')
      const handler = handleMap.get(IPC.SESSION_GET_HISTORY)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, validUuid)

      expect(sessionManager.getBuffer).toHaveBeenCalledWith(validUuid)
      expect(sessionManager.snapshotAndClearBuffer).not.toHaveBeenCalled()
    })
  })

  describe('SESSION_LIST_CONVERSATIONS', () => {
    it('returns conversation list for valid project path', async () => {
      const mockConversations = [
        { id: 'conv-1', title: 'First', lastActive: 1000 },
        { id: 'conv-2', title: 'Second', lastActive: 2000 }
      ]
      conversationHistoryService.listConversations.mockResolvedValue(mockConversations)
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      const result = await handler(event, '/Users/test/project')

      expect(result).toEqual(mockConversations)
      expect(conversationHistoryService.listConversations).toHaveBeenCalledWith(path.resolve('/Users/test/project'))
    })

    it('returns empty array when no conversations exist', async () => {
      conversationHistoryService.listConversations.mockResolvedValue([])
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      const result = await handler(event, '/Users/test/empty-project')

      expect(result).toEqual([])
    })

    it('rejects empty string project path', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(handler(event, '')).rejects.toThrow('Invalid input')
    })

    it('rejects missing project path argument', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(handler(event, undefined)).rejects.toThrow('Invalid input')
    })

    it('rejects null project path', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(handler(event, null)).rejects.toThrow('Invalid input')
    })

    it('rejects numeric project path', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(handler(event, 42)).rejects.toThrow('Invalid input')
    })

    it('returns "Internal error" when service throws unexpected error', async () => {
      conversationHistoryService.listConversations.mockRejectedValue(
        new Error('disk failure')
      )
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(handler(event, '/Users/test/project')).rejects.toThrow('Internal error')
    })

    it('logs unexpected service errors via logger.error', async () => {
      const diskError = new Error('disk failure')
      conversationHistoryService.listConversations.mockRejectedValue(diskError)
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      try {
        await handler(event, '/Users/test/project')
      } catch { /* expected */ }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error in IPC handler on session:listConversations',
        { error: diskError }
      )
    })

    it('accepts single-character project path', async () => {
      conversationHistoryService.listConversations.mockResolvedValue([])
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      const result = await handler(event, '/Users/test/a')

      expect(result).toEqual([])
      expect(conversationHistoryService.listConversations).toHaveBeenCalledWith(path.resolve('/Users/test/a'))
    })

    it('rejects path outside $HOME', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(handler(event, '/etc')).rejects.toThrow('Invalid directory')
    })

    it('rejects home directory prefix attack', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, '/Users/testevil/project')
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects path traversal attack', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, '/Users/test/../../etc')
      ).rejects.toThrow('Invalid directory')
    })
  })

  describe('Windows paths', () => {
    let winSessionManager: ReturnType<typeof createMockSessionManager>
    let winConversationHistoryService: ReturnType<typeof createMockConversationHistoryService>
    const winMockStatAsync = vi.fn()
    const winMockHomedir = vi.fn()
    const winCwdDeps: ValidateCwdDeps = {
      homedir: () => winMockHomedir(),
      stat: (p) => winMockStatAsync(p),
      resolve: path.win32.resolve,
      sep: '\\'
    }

    beforeEach(() => {
      handleMap.clear()
      winSessionManager = createMockSessionManager()
      winConversationHistoryService = createMockConversationHistoryService()
      winMockHomedir.mockReturnValue('C:\\Users\\test')
      winMockStatAsync.mockResolvedValue({ isDirectory: () => true })

      registerSessionHandlers(
        winSessionManager as never,
        winConversationHistoryService as never,
        noopValidateSender,
        mockSendToRenderer,
        winCwdDeps
      )
    })

    it('accepts case-insensitive home path (homedir lowercase, input uppercase)', async () => {
      winMockHomedir.mockReturnValue('C:\\Users\\test')

      handleMap.clear()
      registerSessionHandlers(
        winSessionManager as never,
        winConversationHistoryService as never,
        noopValidateSender,
        mockSendToRenderer,
        winCwdDeps
      )

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: 'C:\\Users\\TEST\\project' })
      expect(winSessionManager.create).toHaveBeenCalled()
    })

    it('accepts case-insensitive home path (homedir uppercase, input lowercase)', async () => {
      winMockHomedir.mockReturnValue('C:\\Users\\TEST')

      handleMap.clear()
      registerSessionHandlers(
        winSessionManager as never,
        winConversationHistoryService as never,
        noopValidateSender,
        mockSendToRenderer,
        winCwdDeps
      )

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: 'C:\\Users\\test\\project' })
      expect(winSessionManager.create).toHaveBeenCalled()
    })

    it('accepts mixed forward and backslashes', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: 'C:\\Users\\test/project' })
      expect(winSessionManager.create).toHaveBeenCalled()
    })

    it('accepts exact case match', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: 'C:\\Users\\test\\project' })
      expect(winSessionManager.create).toHaveBeenCalled()
    })

    it('rejects path on different drive', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: 'D:\\other\\path' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects prefix attack with backslash', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: 'C:\\Users\\testevil\\project' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects traversal with backslashes', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: 'C:\\Users\\test\\..\\admin' })
      ).rejects.toThrow('Invalid directory')
    })
  })

})
