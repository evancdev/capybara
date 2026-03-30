import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionNotFoundError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock electron ipcMain -- capture registered handlers
const handleMap = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, handler)
    }),
    on: vi.fn()
  }
}))

// Mock logger -- used by safe-handler for unhandled error logging.
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({
  logger: mockLogger
}))

// Mock fs/promises and os for validateCwd
const mockExistsSync = vi.fn()
const mockStatAsync = vi.fn()
const mockHomedir = vi.fn()
vi.mock('node:fs/promises', () => ({
  default: {
    stat: (...args: unknown[]) => mockStatAsync(...args)
  },
  stat: (...args: unknown[]) => mockStatAsync(...args)
}))
vi.mock('node:os', () => ({
  default: { homedir: () => mockHomedir() },
  homedir: () => mockHomedir()
}))

// Import after mocks
const { registerSessionHandlers } = await import(
  '@/main/controllers/ipc/session'
)
const { IPC } = await import('@/shared/types/constants')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function noopValidateSender(_event: unknown): void {
  // No-op: all senders accepted
}

const sendToRendererCalls: unknown[][] = []
function mockSendToRenderer(...args: unknown[]): void {
  sendToRendererCalls.push(args)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
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
    mockExistsSync.mockReturnValue(true)
    mockStatAsync.mockResolvedValue({ isDirectory: () => true })

    registerSessionHandlers(
      sessionManager as never,
      conversationHistoryService as never,
      noopValidateSender,
      mockSendToRenderer
    )
  })

  // -------------------------------------------------------------------------
  // safeHandler wrapper (async -- all handlers return Promises)
  // -------------------------------------------------------------------------
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
      } catch {
        // expected
      }

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
      } catch {
        // expected
      }

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
      } catch {
        // expected
      }

      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('returns cwd validation message for CwdValidationError (not "Internal error")', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '/etc' })).rejects.toThrow('Invalid directory')
    })

    it('does not log CwdValidationError via logger.error', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      try {
        await handler(event, { cwd: '/etc' })
      } catch {
        // expected
      }

      expect(mockLogger.error).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // validateCwd
  // -------------------------------------------------------------------------
  describe('validateCwd', () => {
    it('accepts a path directly under $HOME', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('accepts $HOME itself as cwd', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test' })
      expect(sessionManager.create).toHaveBeenCalled()
    })

    it('rejects paths outside $HOME (e.g., /etc)', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '/etc' })).rejects.toThrow('Invalid directory')
    })

    it('rejects /tmp as outside $HOME', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '/tmp' })).rejects.toThrow('Invalid directory')
    })

    it('rejects nonexistent directories', async () => {
      mockHomedir.mockReturnValue('/Users/test')
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
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/../../etc' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects home directory prefix attacks (e.g., /Users/testevil)', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/testevil/project' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects paths that exist but are not directories', async () => {
      mockHomedir.mockReturnValue('/Users/test')
      mockExistsSync.mockReturnValue(true)
      mockStatAsync.mockResolvedValue({ isDirectory: () => false })

      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(
        handler(event, { cwd: '/Users/test/somefile.txt' })
      ).rejects.toThrow('Invalid directory')
    })
  })

  // -------------------------------------------------------------------------
  // Handler routing
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Sender validation
  // -------------------------------------------------------------------------
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
        mockSendToRenderer
      )

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })
  })

  // -------------------------------------------------------------------------
  // SESSION_CREATE specifics
  // -------------------------------------------------------------------------
  describe('SESSION_CREATE', () => {
    it('passes validated cwd and callbacks to sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project', name: 'My Agent' })

      expect(sessionManager.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/Users/test/project',
          name: 'My Agent'
        }),
        expect.any(Function),
        expect.any(Function)
      )
    })

    it('rejects invalid schema input (missing cwd)', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, {})).rejects.toThrow('Invalid input')
    })

  })

  // -------------------------------------------------------------------------
  // SESSION_DESTROY
  // -------------------------------------------------------------------------
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
  })

  // -------------------------------------------------------------------------
  // SESSION_LIST
  // -------------------------------------------------------------------------
  describe('SESSION_LIST', () => {
    it('returns the list from sessionManager', async () => {
      const mockList = [{ id: 'abc', name: 'Agent 1' }]
      sessionManager.list.mockReturnValue(mockList)

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBe(mockList)
    })
  })

  // -------------------------------------------------------------------------
  // SESSION_RESIZE
  // -------------------------------------------------------------------------
  describe('SESSION_RESIZE', () => {
    it('calls sessionManager.resize with parsed inputs', async () => {
      const handler = handleMap.get(IPC.SESSION_RESIZE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, { sessionId: validUuid, cols: 120, rows: 40 })

      expect(sessionManager.resize).toHaveBeenCalledWith(validUuid, 120, 40)
    })

    it('rejects invalid schema input (missing cols)', async () => {
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
  })

  // -------------------------------------------------------------------------
  // SESSION_RENAME
  // -------------------------------------------------------------------------
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
  })

  // -------------------------------------------------------------------------
  // SESSION_RENAME additional
  // -------------------------------------------------------------------------
  describe('SESSION_RENAME validation', () => {
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
  })

  // -------------------------------------------------------------------------
  // SESSION_REPLAY
  // -------------------------------------------------------------------------
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
  })

  // -------------------------------------------------------------------------
  // SESSION_GET_HISTORY
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // SESSION_LIST_CONVERSATIONS
  // -------------------------------------------------------------------------
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
      expect(conversationHistoryService.listConversations).toHaveBeenCalledWith('/Users/test/project')
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
      } catch {
        // expected
      }

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
      expect(conversationHistoryService.listConversations).toHaveBeenCalledWith('/Users/test/a')
    })
  })

})
