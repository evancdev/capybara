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
    showOpenDialog: (...args: unknown[]) => mockShowOpenDialog(...args) as unknown
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

let mockGetWindow: () => Electron.BrowserWindow | null = () => null

vi.mock('@/main/bootstrap/window', () => ({
  getWindow: () => mockGetWindow()
}))

// Import after mocks are established
const { registerSystemHandlers } = await import(
  '@/main/ipc/inbound/system'
)
const { IPC } = await import('@/shared/types/constants')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEvent(senderId = 1) {
  return { sender: { id: senderId } } as unknown as Electron.IpcMainInvokeEvent
}

function createMockBrowserWindow(options?: { destroyed?: boolean }) {
  return {
    isDestroyed: vi.fn().mockReturnValue(options?.destroyed ?? false),
    webContents: { id: 1 }
  } as unknown as Electron.BrowserWindow
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = handleMap.get(channel)
  if (!handler) {
    throw new Error(`No handler for ${channel}`)
  }
  return handler
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('IPC System Handlers', () => {
  let mockWindow: ReturnType<typeof createMockBrowserWindow>

  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
    mockWindow = createMockBrowserWindow()
    mockGetWindow = () => mockWindow

    registerSystemHandlers()
  })

  // -------------------------------------------------------------------------
  // Handler registration
  // -------------------------------------------------------------------------
  describe('handler registration', () => {
    it('registers DIALOG_OPEN_DIRECTORY channel', () => {
      expect(handleMap.has(IPC.DIALOG_OPEN_DIRECTORY)).toBe(true)
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

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBe('/Users/test/chosen-dir')
    })

    it('passes openDirectory property to showOpenDialog', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/dir']
      })

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
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

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
    })

    it('returns null when filePaths array is empty', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: []
      })

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
    })

    it('returns only the first path when multiple are selected', async () => {
      mockShowOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: ['/Users/test/dir1', '/Users/test/dir2']
      })

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBe('/Users/test/dir1')
    })

    it('rejects as unauthorized when getWindow returns null', async () => {
      // validateSender rejects before the handler runs: no window means no
      // legitimate caller. The handler's own null-window branch never executes.
      mockGetWindow = () => null

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Unauthorized')
      expect(mockShowOpenDialog).not.toHaveBeenCalled()
    })

    it('returns null when window is destroyed', async () => {
      // validateSender only checks webContents.id, not destroyed state, so the
      // handler's own destroyed-check is still the one that returns null.
      const destroyedWindow = createMockBrowserWindow({ destroyed: true })
      mockGetWindow = () => destroyedWindow

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      const result = await handler(event)

      expect(result).toBeNull()
      expect(mockShowOpenDialog).not.toHaveBeenCalled()
    })

    it('returns "Internal error" when showOpenDialog throws', async () => {
      mockShowOpenDialog.mockRejectedValue(new Error('dialog crashed'))

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent()

      await expect(handler(event)).rejects.toThrow('Internal error')
    })

    it('logs unexpected dialog errors via logger.error', async () => {
      const dialogError = new Error('dialog crashed')
      mockShowOpenDialog.mockRejectedValue(dialogError)

      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
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

    it('rejects when sender id does not match main window', async () => {
      // Main window webContents.id=1, but event sender claims id=999.
      const handler = getHandler(IPC.DIALOG_OPEN_DIRECTORY)
      const event = createMockEvent(999)

      await expect(handler(event)).rejects.toThrow('Unauthorized')
    })
  })
})
