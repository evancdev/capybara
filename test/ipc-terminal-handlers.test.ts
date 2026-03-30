import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionNotFoundError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const onMap = new Map<string, (...args: unknown[]) => void>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      onMap.set(channel, handler)
    })
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

const { registerTerminalHandlers } = await import(
  '@/main/controllers/ipc/terminal'
)
const { IPC } = await import('@/shared/types/constants')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSessionManager() {
  return {
    write: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
    list: vi.fn(),
    rename: vi.fn(),
    resize: vi.fn(),
    snapshotAndClearBuffer: vi.fn(),
    destroyAll: vi.fn()
  }
}

function createMockEvent(senderId = 1) {
  return { sender: { id: senderId } } as unknown as Electron.IpcMainEvent
}

function noopValidateSender(_event: unknown): void {
  // accept all
}

// A valid UUID that will pass SessionIdSchema.parse
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('IPC Terminal Handlers', () => {
  let sessionManager: ReturnType<typeof createMockSessionManager>

  beforeEach(() => {
    vi.clearAllMocks()
    onMap.clear()
    sessionManager = createMockSessionManager()

    registerTerminalHandlers(sessionManager as never, noopValidateSender)
  })

  it('registers the TERMINAL_INPUT channel', () => {
    expect(onMap.has(IPC.TERMINAL_INPUT)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Valid input
  // -------------------------------------------------------------------------
  describe('valid input', () => {
    it('calls sessionManager.write for valid string data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, 'hello world')

      expect(sessionManager.write).toHaveBeenCalledWith(
        VALID_UUID,
        'hello world'
      )
    })

    it('does not log errors for valid input', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, 'valid data')

      expect(mockLogger.error).not.toHaveBeenCalled()
      expect(mockLogger.warn).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Empty data
  // -------------------------------------------------------------------------
  describe('empty data rejection', () => {
    it('rejects empty string data and logs error', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, '')

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error in terminal input handler',
        expect.objectContaining({ error: expect.any(Error) })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Non-string data
  // -------------------------------------------------------------------------
  describe('non-string data rejection', () => {
    it('rejects numeric data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, 42)

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('rejects null data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, null)

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('rejects undefined data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, undefined)

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('rejects object data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, { payload: 'data' })

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('rejects array data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, ['a', 'b'])

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('rejects boolean data', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, true)

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // MAX_INPUT_LENGTH
  // -------------------------------------------------------------------------
  describe('MAX_INPUT_LENGTH enforcement', () => {
    it('rejects data exceeding 64KB', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()
      const oversized = 'x'.repeat(64 * 1024 + 1)

      handler(event, VALID_UUID, oversized)

      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('accepts data at exactly 64KB', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()
      const exactly64k = 'x'.repeat(64 * 1024)

      handler(event, VALID_UUID, exactly64k)

      expect(sessionManager.write).toHaveBeenCalledWith(VALID_UUID, exactly64k)
    })

    it('accepts data at 1 byte below 64KB', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()
      const under64k = 'x'.repeat(64 * 1024 - 1)

      handler(event, VALID_UUID, under64k)

      expect(sessionManager.write).toHaveBeenCalledWith(VALID_UUID, under64k)
    })
  })

  // -------------------------------------------------------------------------
  // SessionNotFoundError routing
  // -------------------------------------------------------------------------
  describe('SessionNotFoundError logging', () => {
    it('logs SessionNotFoundError as warn, not error', () => {
      sessionManager.write.mockImplementation(() => {
        throw new SessionNotFoundError('missing-session')
      })

      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, 'data')

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Terminal input for unknown session',
        expect.objectContaining({
          error: expect.any(SessionNotFoundError)
        })
      )
      expect(mockLogger.error).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Sender validation
  // -------------------------------------------------------------------------
  describe('sender validation', () => {
    it('rejects calls from invalid sender', () => {
      onMap.clear()
      const throwingSender = () => {
        throw new Error('[IPC] sender is not the main window')
      }
      registerTerminalHandlers(sessionManager as never, throwingSender)

      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, VALID_UUID, 'data')

      // The error from validateSender is not SessionNotFoundError, so it
      // should be logged as error
      expect(sessionManager.write).not.toHaveBeenCalled()
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unexpected error in terminal input handler',
        expect.objectContaining({ error: expect.any(Error) })
      )
    })
  })

  // -------------------------------------------------------------------------
  // Invalid session ID
  // -------------------------------------------------------------------------
  describe('invalid session ID', () => {
    it('rejects non-UUID session ID and logs warning', () => {
      const handler = onMap.get(IPC.TERMINAL_INPUT)!
      const event = createMockEvent()

      handler(event, 'not-a-uuid', 'data')

      expect(sessionManager.write).not.toHaveBeenCalled()
      // ZodError from SessionIdSchema → logger.warn (validation failure, not unexpected error)
      expect(mockLogger.warn).toHaveBeenCalled()
    })
  })
})
