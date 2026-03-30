import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture registered handlers keyed by IPC channel name
const handleMap = new Map<string, (...args: unknown[]) => unknown>()

// Mock Electron modules
const mockShowOpenDialog = vi.fn()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handleMap.set(channel, handler)
    }),
    on: vi.fn()
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args)
  }
}))

// Mock logger -- used by safe-handler for error logging
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({
  logger: mockLogger
}))

// Mock os for deterministic prompt info
const mockUsername = vi.fn()
const mockHostname = vi.fn()
vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({ username: mockUsername() }),
    hostname: () => mockHostname()
  },
  userInfo: () => ({ username: mockUsername() }),
  hostname: () => mockHostname()
}))

// Import after mocks are established
const { registerSystemHandlers } = await import(
  '@/main/controllers/ipc/system'
)
const { IPC } = await import('@/shared/types/constants')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEvent(senderId = 1) {
  return { sender: { id: senderId } } as unknown as Electron.IpcMainInvokeEvent
}

function noopValidateSender(_event: unknown): void {
  // No-op: all senders accepted
}

function createMockBrowserWindow(options?: { destroyed?: boolean }) {
  return {
    isDestroyed: vi.fn().mockReturnValue(options?.destroyed ?? false),
    webContents: { id: 1 }
  } as unknown as Electron.BrowserWindow
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('IPC System Handlers', () => {
  let mockWindow: ReturnType<typeof createMockBrowserWindow>

  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
    mockUsername.mockReturnValue('testuser')
    mockHostname.mockReturnValue('testhost')
    mockWindow = createMockBrowserWindow()

    registerSystemHandlers(
      () => mockWindow,
      noopValidateSender
    )
  })

  // -------------------------------------------------------------------------
  // Handler registration
  // -------------------------------------------------------------------------
  describe('handler registration', () => {
    it('registers GET_PROMPT_INFO channel', () => {
      expect(handleMap.has(IPC.GET_PROMPT_INFO)).toBe(true)
    })

    it('registers DIALOG_OPEN_DIRECTORY channel', () => {
      expect(handleMap.has(IPC.DIALOG_OPEN_DIRECTORY)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // GET_PROMPT_INFO
  // -------------------------------------------------------------------------
  describe('GET_PROMPT_INFO', () => {
    it('returns object with username and hostname', async () => {
      const handler = handleMap.get(IPC.GET_PROMPT_INFO)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toEqual({
        username: 'testuser',
        hostname: 'testhost'
      })
    })

    it('strips .local suffix from hostname', async () => {
      handleMap.clear()
      mockHostname.mockReturnValue('mymac.local')

      registerSystemHandlers(
        () => mockWindow,
        noopValidateSender
      )

      const handler = handleMap.get(IPC.GET_PROMPT_INFO)!
      const event = createMockEvent()

      const result = await handler(event) as { username: string; hostname: string }

      expect(result.hostname).toBe('mymac')
    })

    it('preserves hostname that does not end in .local', async () => {
      handleMap.clear()
      mockHostname.mockReturnValue('server.example.com')

      registerSystemHandlers(
        () => mockWindow,
        noopValidateSender
      )

      const handler = handleMap.get(IPC.GET_PROMPT_INFO)!
      const event = createMockEvent()

      const result = await handler(event) as { username: string; hostname: string }

      expect(result.hostname).toBe('server.example.com')
    })

    it('returns consistent values across multiple calls', async () => {
      const handler = handleMap.get(IPC.GET_PROMPT_INFO)!
      const event = createMockEvent()

      const result1 = await handler(event)
      const result2 = await handler(event)

      expect(result1).toEqual(result2)
    })

    it('rejects when validateSender throws', async () => {
      handleMap.clear()
      const throwingSender = () => {
        throw new Error('[IPC] sender is not the main window')
      }

      registerSystemHandlers(
        () => mockWindow,
        throwingSender
      )

      const handler = handleMap.get(IPC.GET_PROMPT_INFO)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })
  })

  // -------------------------------------------------------------------------
  // DIALOG_OPEN_DIRECTORY
  // -------------------------------------------------------------------------
  describe('DIALOG_OPEN_DIRECTORY', () => {
    it('returns selected directory path on successful selection', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/chosen-dir']
      })

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBe('/Users/test/chosen-dir')
    })

    it('passes openDirectory property to showOpenDialog', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/dir']
      })

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      await handler(event)

      expect(mockShowOpenDialog).toHaveBeenCalledWith(
        mockWindow,
        { properties: ['openDirectory'] }
      )
    })

    it('returns null when dialog is canceled', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: []
      })

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
    })

    it('returns null when filePaths array is empty', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: []
      })

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
    })

    it('returns only the first path when multiple are selected', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/dir1', '/Users/test/dir2']
      })

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBe('/Users/test/dir1')
    })

    it('returns null when getMainWindow returns null', async () => {
      handleMap.clear()

      registerSystemHandlers(
        () => null,
        noopValidateSender
      )

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
      expect(mockShowOpenDialog).not.toHaveBeenCalled()
    })

    it('returns null when window is destroyed', async () => {
      handleMap.clear()
      const destroyedWindow = createMockBrowserWindow({ destroyed: true })

      registerSystemHandlers(
        () => destroyedWindow,
        noopValidateSender
      )

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
      expect(mockShowOpenDialog).not.toHaveBeenCalled()
    })

    it('returns "Internal error" when showOpenDialog throws', async () => {
      mockShowOpenDialog.mockRejectedValue(new Error('dialog crashed'))

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })

    it('logs unexpected dialog errors via logger.error', async () => {
      const dialogError = new Error('dialog crashed')
      mockShowOpenDialog.mockRejectedValue(dialogError)

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      try {
        await handler(event)
      } catch {
        // expected
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unhandled error in IPC handler on dialog:openDirectory',
        { error: dialogError }
      )
    })

    it('rejects when validateSender throws', async () => {
      handleMap.clear()
      const throwingSender = () => {
        throw new Error('[IPC] sender is not the main window')
      }

      registerSystemHandlers(
        () => mockWindow,
        throwingSender
      )

      const handler = handleMap.get(IPC.DIALOG_OPEN_DIRECTORY)!
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })
  })
})
