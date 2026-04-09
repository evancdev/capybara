import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionNotFoundError } from '@/main/lib/errors'
import type * as TransportModule from '@/main/ipc/transport'
import type { CwdDeps } from '@/main/types/cwd'
import { TEST_UUIDS } from '../../../fixtures/uuids'

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

const sendToRendererCalls: unknown[][] = []
const mockSendToRenderer = vi.fn((...args: unknown[]) => {
  sendToRendererCalls.push(args)
})

vi.mock('@/main/ipc/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof TransportModule>()
  return {
    ...actual,
    sendToRenderer: (...args: unknown[]) => mockSendToRenderer(...args)
  }
})

// Window mock so the real validateSender inside handle() passes.
// Tests flip `mockWindowId` to simulate unauthorized callers.
let mockWindowId: number | null = 1
vi.mock('@/main/bootstrap/window', () => ({
  getWindow: () =>
    mockWindowId === null
      ? null
      : ({ webContents: { id: mockWindowId } } as unknown as Electron.BrowserWindow)
}))

const mockListConversations = vi.fn().mockResolvedValue([])
const mockRenameConversation = vi.fn().mockResolvedValue(undefined)

const mockStatAsync = vi.fn()
const mockHomedir = vi.fn()
const mockCwdDeps: CwdDeps = {
  homedir: () => mockHomedir(),
  stat: (p) => mockStatAsync(p),
  resolve: path.resolve,
  realpath: (p: string) => Promise.resolve(p),
  sep: path.sep
}

const { registerSessionHandlers } = await import('@/main/ipc/inbound/session')
const { IPC } = await import('@/shared/types/constants')

function createMockSessionManager() {
  return {
    create: vi.fn().mockResolvedValue({
      id: 'test-uuid',
      status: 'running',
      exitCode: null,
      createdAt: Date.now(),
      metadata: {}
    }),
    destroy: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    write: vi.fn(),
    sendInterAgentMessage: vi.fn(),
    stopResponse: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    handleToolApprovalResponse: vi.fn(),
    destroyAll: vi.fn(),
    listConversations: mockListConversations,
    renameConversation: mockRenameConversation,
    on: vi.fn(),
    emit: vi.fn()
  }
}

function createMockEvent(senderId = 1) {
  return { sender: { id: senderId } } as unknown as Electron.IpcMainInvokeEvent
}

describe('IPC Session Handlers', () => {
  let sessionManager: ReturnType<typeof createMockSessionManager>

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindowId = 1
    handleMap.clear()
    sendToRendererCalls.length = 0
    sessionManager = createMockSessionManager()
    mockHomedir.mockReturnValue('/Users/test')
    mockStatAsync.mockResolvedValue({ isDirectory: () => true })

    registerSessionHandlers(
      sessionManager as never,
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
      const validUuid = TEST_UUIDS.session

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
        await handler(event, TEST_UUIDS.session)
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
        await handler(event, TEST_UUIDS.session)
      } catch { /* expected */ }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('IPC SessionNotFoundError on'),
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
        expect.stringContaining('IPC CwdValidationError on'),
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
      expect(handleMap.has(IPC.SESSION_LIST_CONVERSATIONS)).toBe(true)
      expect(handleMap.has(IPC.SESSION_SEND_MESSAGE)).toBe(true)
      expect(handleMap.has(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)).toBe(true)
      expect(handleMap.has(IPC.SESSION_GET_MESSAGES)).toBe(true)
      expect(handleMap.has(IPC.TOOL_APPROVAL_RESPONSE)).toBe(true)
    })
  })

  describe('sender validation', () => {
    it('rejects calls from an unauthorized sender', async () => {
      mockWindowId = 999 // main window id, doesn't match event sender id=1

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Unauthorized')
    })

    it('rejects calls when no window exists', async () => {
      mockWindowId = null

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Unauthorized')
    })
  })

  describe('SESSION_CREATE', () => {
    it('passes validated cwd to sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await handler(event, { cwd: '/Users/test/project' })

      expect(sessionManager.create).toHaveBeenCalledWith(
        path.resolve('/Users/test/project'),
        undefined
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
      const resumeId = TEST_UUIDS.session

      await handler(event, { cwd: '/Users/test/project', resumeConversationId: resumeId })

      expect(sessionManager.create).toHaveBeenCalledWith(
        path.resolve('/Users/test/project'),
        resumeId
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

      expect(sessionManager.create).toHaveBeenCalledWith(
        path.resolve('/Users/test/project'),
        undefined
      )
    })

    it('returns the session descriptor from sessionManager.create', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      const result = await handler(event, { cwd: '/Users/test/project' })

      expect(result).toEqual(
        expect.objectContaining({
          id: 'test-uuid',
          status: 'running'
        })
      )
    })

    it('rejects empty cwd string', async () => {
      const handler = handleMap.get(IPC.SESSION_CREATE)!
      const event = createMockEvent()

      await expect(handler(event, { cwd: '' })).rejects.toThrow('Invalid input')
    })

  })

  describe('SESSION_DESTROY', () => {
    it('calls sessionManager.destroy with parsed UUID', async () => {
      const handler = handleMap.get(IPC.SESSION_DESTROY)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

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
      const mockList = [{ id: 'abc', status: 'running' }]
      sessionManager.list.mockReturnValue(mockList)

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toStrictEqual(mockList)
    })

    it('returns empty array when no sessions exist', async () => {
      sessionManager.list.mockReturnValue([])

      const handler = handleMap.get(IPC.SESSION_LIST)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toEqual([])
    })
  })

  describe('SESSION_STOP_RESPONSE', () => {
    it('calls sessionManager.stopResponse with parsed UUID', async () => {
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await handler(event, validUuid)

      expect(sessionManager.stopResponse).toHaveBeenCalledWith(validUuid)
    })

    it('rejects non-UUID session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()

      await expect(handler(event, 'not-a-uuid')).rejects.toThrow('Invalid input')
    })

    it('rejects missing session ID (undefined)', async () => {
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()

      await expect(handler(event, undefined)).rejects.toThrow('Invalid input')
    })

    it('rejects null session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()

      await expect(handler(event, null)).rejects.toThrow('Invalid input')
    })

    it('rejects numeric session ID', async () => {
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()

      await expect(handler(event, 12345)).rejects.toThrow('Invalid input')
    })

    it('returns "Session not found" when sessionManager throws', async () => {
      sessionManager.stopResponse.mockImplementation(() => {
        throw new SessionNotFoundError('gone')
      })

      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid)).rejects.toThrow(
        'Session not found'
      )
    })

    it('does not return a value (fire and forget)', async () => {
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      const result = await handler(event, validUuid)
      expect(result).toBeUndefined()
    })

    it('rejects unauthorized callers before stopping', async () => {
      mockWindowId = 999
      const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE)!
      const event = createMockEvent()
      const validUuid = '550e8400-e29b-41d4-a716-446655440000'

      await expect(handler(event, validUuid)).rejects.toThrow('Unauthorized')
      expect(sessionManager.stopResponse).not.toHaveBeenCalled()
    })
  })

  describe('SESSION_SEND_MESSAGE', () => {
    it('calls sessionManager.write with parsed sessionId and message', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await handler(event, { sessionId: validUuid, message: 'hello' })

      expect(sessionManager.write).toHaveBeenCalledWith(validUuid, 'hello')
    })

    it('rejects missing message', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, { sessionId: validUuid })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects missing sessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, { message: 'hello' })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects invalid UUID in sessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, { sessionId: 'not-a-uuid', message: 'Hello' })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects empty message', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, { sessionId: validUuid, message: '' })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects message exceeding 100000 characters', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, { sessionId: validUuid, message: 'a'.repeat(100001) })
      ).rejects.toThrow('Invalid input')
    })

    it('accepts message at exactly 100000 characters', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_MESSAGE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await handler(event, { sessionId: validUuid, message: 'a'.repeat(100000) })

      expect(sessionManager.write).toHaveBeenCalled()
    })
  })

  describe('SESSION_SEND_INTER_AGENT_MESSAGE', () => {
    const FROM_UUID = TEST_UUIDS.session
    const TO_UUID = TEST_UUIDS.otherSession

    it('calls sessionManager.sendInterAgentMessage with parsed input', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await handler(event, {
        fromSessionId: FROM_UUID,
        toSessionId: TO_UUID,
        content: 'hello other agent'
      })

      expect(sessionManager.sendInterAgentMessage).toHaveBeenCalledWith({
        fromSessionId: FROM_UUID,
        toSessionId: TO_UUID,
        content: 'hello other agent'
      })
    })

    it('rejects missing fromSessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, { toSessionId: TO_UUID, content: 'hi' })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('rejects missing toSessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, { fromSessionId: FROM_UUID, content: 'hi' })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('rejects missing content', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, { fromSessionId: FROM_UUID, toSessionId: TO_UUID })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('rejects non-UUID fromSessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: 'not-a-uuid',
          toSessionId: TO_UUID,
          content: 'hi'
        })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('rejects non-UUID toSessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: FROM_UUID,
          toSessionId: 'not-a-uuid',
          content: 'hi'
        })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('rejects empty content', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: FROM_UUID,
          toSessionId: TO_UUID,
          content: ''
        })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('rejects content exceeding 100000 characters', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: FROM_UUID,
          toSessionId: TO_UUID,
          content: 'a'.repeat(100001)
        })
      ).rejects.toThrow('Invalid input')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })

    it('does not pass excess properties through to the service', async () => {
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await handler(event, {
        fromSessionId: FROM_UUID,
        toSessionId: TO_UUID,
        content: 'hi',
        fromSessionName: 'forged',
        malicious: true
      })

      expect(sessionManager.sendInterAgentMessage).toHaveBeenCalledWith({
        fromSessionId: FROM_UUID,
        toSessionId: TO_UUID,
        content: 'hi'
      })
    })

    it('returns "Session not found" when service throws SessionNotFoundError', async () => {
      sessionManager.sendInterAgentMessage.mockImplementation(() => {
        throw new SessionNotFoundError('missing')
      })
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: FROM_UUID,
          toSessionId: TO_UUID,
          content: 'hi'
        })
      ).rejects.toThrow('Session not found')
    })

    it('returns "Internal error" when service throws a generic Error (e.g. self-send, not-running)', async () => {
      sessionManager.sendInterAgentMessage.mockImplementation(() => {
        throw new Error('Cannot send inter-agent message to self')
      })
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: FROM_UUID,
          toSessionId: TO_UUID,
          content: 'hi'
        })
      ).rejects.toThrow('Internal error')
    })

    it('rejects unauthorized callers before invoking the service', async () => {
      mockWindowId = 999
      const handler = handleMap.get(IPC.SESSION_SEND_INTER_AGENT_MESSAGE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          fromSessionId: FROM_UUID,
          toSessionId: TO_UUID,
          content: 'hi'
        })
      ).rejects.toThrow('Unauthorized')
      expect(sessionManager.sendInterAgentMessage).not.toHaveBeenCalled()
    })
  })

  describe('SESSION_GET_MESSAGES', () => {
    it('calls sessionManager.getMessages with parsed sessionId', async () => {
      const mockMessages = [{ kind: 'assistant_message', sessionId: 'x' }]
      sessionManager.getMessages.mockReturnValue(mockMessages)

      const handler = handleMap.get(IPC.SESSION_GET_MESSAGES)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      const result = await handler(event, { sessionId: validUuid })

      expect(sessionManager.getMessages).toHaveBeenCalledWith(validUuid)
      expect(result).toEqual(mockMessages)
    })

    it('rejects invalid sessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_GET_MESSAGES)!
      const event = createMockEvent()

      await expect(
        handler(event, { sessionId: 'not-a-uuid' })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects missing sessionId', async () => {
      const handler = handleMap.get(IPC.SESSION_GET_MESSAGES)!
      const event = createMockEvent()

      await expect(handler(event, {})).rejects.toThrow('Invalid input')
    })

    it('returns "Session not found" for missing session', async () => {
      sessionManager.getMessages.mockImplementation(() => {
        throw new SessionNotFoundError('gone')
      })

      const handler = handleMap.get(IPC.SESSION_GET_MESSAGES)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, { sessionId: validUuid })
      ).rejects.toThrow('Session not found')
    })
  })

  // -------------------------------------------------------------------------
  // TOOL_APPROVAL_RESPONSE
  // -------------------------------------------------------------------------
  describe('TOOL_APPROVAL_RESPONSE', () => {
    it('calls handleToolApprovalResponse with approve decision', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await handler(event, {
        sessionId: validUuid,
        toolUseId: 'tool-1',
        decision: 'approve'
      })

      expect(sessionManager.handleToolApprovalResponse).toHaveBeenCalledWith(
        validUuid,
        'tool-1',
        'approve',
        null
      )
    })

    it('calls handleToolApprovalResponse with deny decision', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await handler(event, {
        sessionId: validUuid,
        toolUseId: 'tool-2',
        decision: 'deny',
        message: 'Too risky'
      })

      expect(sessionManager.handleToolApprovalResponse).toHaveBeenCalledWith(
        validUuid,
        'tool-2',
        'deny',
        'Too risky'
      )
    })

    it('rejects modify decision (not supported)', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, {
          sessionId: validUuid,
          toolUseId: 'tool-3',
          decision: 'modify'
        })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects invalid decision value', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, {
          sessionId: validUuid,
          toolUseId: 'tool-1',
          decision: 'maybe'
        })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects empty toolUseId', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, {
          sessionId: validUuid,
          toolUseId: '',
          decision: 'approve'
        })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects invalid UUID in sessionId', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          sessionId: 'not-uuid',
          toolUseId: 'tool-1',
          decision: 'approve'
        })
      ).rejects.toThrow('Invalid input')
    })

    it('rejects message exceeding 10000 characters', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await expect(
        handler(event, {
          sessionId: validUuid,
          toolUseId: 'tool-1',
          decision: 'deny',
          message: 'x'.repeat(10001)
        })
      ).rejects.toThrow('Invalid input')
    })

    it('accepts null message', async () => {
      const handler = handleMap.get(IPC.TOOL_APPROVAL_RESPONSE)!
      const event = createMockEvent()
      const validUuid = TEST_UUIDS.session

      await handler(event, {
        sessionId: validUuid,
        toolUseId: 'tool-1',
        decision: 'approve',
        message: null
      })

      expect(sessionManager.handleToolApprovalResponse).toHaveBeenCalledWith(
        validUuid,
        'tool-1',
        'approve',
        null
      )
    })
  })

  describe('SESSION_LIST_CONVERSATIONS', () => {
    it('returns conversation list for valid project path', async () => {
      const mockConversations = [
        { id: 'conv-1', title: 'First', lastActive: 1000 },
        { id: 'conv-2', title: 'Second', lastActive: 2000 }
      ]
      mockListConversations.mockResolvedValue(mockConversations)
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      const result = await handler(event, {
        projectPath: '/Users/test/project'
      })

      expect(result).toEqual(mockConversations)
      expect(mockListConversations).toHaveBeenCalledWith(
        path.resolve('/Users/test/project')
      )
    })

    it('returns empty array when no conversations exist', async () => {
      mockListConversations.mockResolvedValue([])
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      const result = await handler(event, {
        projectPath: '/Users/test/empty-project'
      })

      expect(result).toEqual([])
    })

    it('rejects empty string project path', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, { projectPath: '' })
      ).rejects.toThrow('Invalid input')
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

      await expect(
        handler(event, { projectPath: 42 })
      ).rejects.toThrow('Invalid input')
    })

    it('returns "Internal error" when service throws unexpected error', async () => {
      mockListConversations.mockRejectedValue(
        new Error('disk failure')
      )
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          projectPath: '/Users/test/project'
        })
      ).rejects.toThrow('Internal error')
    })

    it('logs unexpected service errors via logger.error', async () => {
      const diskError = new Error('disk failure')
      mockListConversations.mockRejectedValue(diskError)
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      try {
        await handler(event, {
          projectPath: '/Users/test/project'
        })
      } catch { /* expected */ }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error in IPC handler on session:listConversations',
        { error: diskError }
      )
    })

    it('accepts single-character project path', async () => {
      mockListConversations.mockResolvedValue([])
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      const result = await handler(event, {
        projectPath: '/Users/test/a'
      })

      expect(result).toEqual([])
      expect(mockListConversations).toHaveBeenCalledWith(
        path.resolve('/Users/test/a')
      )
    })

    it('rejects path outside $HOME', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, { projectPath: '/etc' })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects home directory prefix attack', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          projectPath: '/Users/testevil/project'
        })
      ).rejects.toThrow('Invalid directory')
    })

    it('rejects path traversal attack', async () => {
      const handler = handleMap.get(IPC.SESSION_LIST_CONVERSATIONS)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          projectPath: '/Users/test/../../etc'
        })
      ).rejects.toThrow('Invalid directory')
    })
  })

  describe('SESSION_RENAME_CONVERSATION', () => {
    it('registers the channel on setup', () => {
      expect(handleMap.has(IPC.SESSION_RENAME_CONVERSATION)).toBe(true)
    })

    it('renames a conversation with cwd (validates the cwd)', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent()

      await handler(event, {
        conversationId: TEST_UUIDS.session,
        title: 'New title',
        cwd: '/Users/test/project'
      })

      expect(mockRenameConversation).toHaveBeenCalledWith(
        TEST_UUIDS.session,
        'New title',
        path.resolve('/Users/test/project')
      )
    })

    it('renames a conversation without cwd (passes undefined through)', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent()

      await handler(event, {
        conversationId: TEST_UUIDS.session,
        title: 'No cwd title'
      })

      expect(mockRenameConversation).toHaveBeenCalledWith(
        TEST_UUIDS.session,
        'No cwd title',
        undefined
      )
    })

    it('rejects non-UUID conversationId with "Invalid input"', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent()

      await expect(
        handler(event, { conversationId: 'not-a-uuid', title: 'x' })
      ).rejects.toThrow('Invalid input')
      expect(mockRenameConversation).not.toHaveBeenCalled()
    })

    it('rejects empty title with "Invalid input"', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent()

      await expect(
        handler(event, { conversationId: TEST_UUIDS.session, title: '' })
      ).rejects.toThrow('Invalid input')
      expect(mockRenameConversation).not.toHaveBeenCalled()
    })

    it('rejects cwd outside home as "Invalid directory"', async () => {
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent()

      await expect(
        handler(event, {
          conversationId: TEST_UUIDS.session,
          title: 'x',
          cwd: '/etc'
        })
      ).rejects.toThrow('Invalid directory')
      expect(mockRenameConversation).not.toHaveBeenCalled()
    })

    it('propagates renameConversation rejection as "Internal error"', async () => {
      mockRenameConversation.mockRejectedValueOnce(new Error('disk full'))
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent()

      await expect(
        handler(event, { conversationId: TEST_UUIDS.session, title: 'x' })
      ).rejects.toThrow('Internal error')
    })

    it('rejects when sender is unauthorized', async () => {
      mockWindowId = 42
      const handler = handleMap.get(IPC.SESSION_RENAME_CONVERSATION)!
      const event = createMockEvent(1)

      await expect(
        handler(event, { conversationId: TEST_UUIDS.session, title: 'x' })
      ).rejects.toThrow('Unauthorized')
    })
  })

  describe('Windows paths', () => {
    let winSessionManager: ReturnType<typeof createMockSessionManager>
    const winMockStatAsync = vi.fn()
    const winMockHomedir = vi.fn()
    const winCwdDeps: CwdDeps = {
      homedir: () => winMockHomedir(),
      stat: (p) => winMockStatAsync(p),
      resolve: path.win32.resolve,
      realpath: (p: string) => Promise.resolve(p),
      sep: '\\'
    }

    beforeEach(() => {
      handleMap.clear()
      winSessionManager = createMockSessionManager()
      winMockHomedir.mockReturnValue('C:\\Users\\test')
      winMockStatAsync.mockResolvedValue({ isDirectory: () => true })

      registerSessionHandlers(
        winSessionManager as never,
        winCwdDeps
      )
    })

    it('accepts case-insensitive home path (homedir lowercase, input uppercase)', async () => {
      winMockHomedir.mockReturnValue('C:\\Users\\test')

      handleMap.clear()
      registerSessionHandlers(
        winSessionManager as never,
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
