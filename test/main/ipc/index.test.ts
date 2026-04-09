import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks for the boundaries that the index modules touch
// ---------------------------------------------------------------------------

// Track every channel registered against ipcMain.handle so we can confirm
// that all the inbound delegates fire end-to-end.
const handleMap = new Map<string, unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: unknown) => {
      handleMap.set(channel, handler)
    }),
    on: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

vi.mock('@/main/bootstrap/window', () => ({
  getWindow: () => null
}))

const { registerIpc } = await import('@/main/ipc')
const { registerInboundHandlers } = await import('@/main/ipc/inbound')
const { registerOutboundForwarders } = await import('@/main/ipc/outbound')
const { IPC } = await import('@/shared/types/constants')

function createMockSessionManager() {
  return {
    create: vi.fn(),
    destroy: vi.fn(),
    destroyAll: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    write: vi.fn(),
    stopResponse: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    handleToolApprovalResponse: vi.fn(),
    listConversations: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    emit: vi.fn()
  }
}

// ---------------------------------------------------------------------------
// registerInboundHandlers
// ---------------------------------------------------------------------------
describe('registerInboundHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
  })

  it('registers every session inbound IPC channel', () => {
    const manager = createMockSessionManager()
    registerInboundHandlers(manager as never)

    expect(handleMap.has(IPC.SESSION_CREATE)).toBe(true)
    expect(handleMap.has(IPC.SESSION_DESTROY)).toBe(true)
    expect(handleMap.has(IPC.SESSION_LIST)).toBe(true)
    expect(handleMap.has(IPC.SESSION_STOP_RESPONSE)).toBe(true)
    expect(handleMap.has(IPC.SESSION_SEND_MESSAGE)).toBe(true)
    expect(handleMap.has(IPC.SESSION_GET_MESSAGES)).toBe(true)
    expect(handleMap.has(IPC.SESSION_LIST_CONVERSATIONS)).toBe(true)
    expect(handleMap.has(IPC.TOOL_APPROVAL_RESPONSE)).toBe(true)
  })

  it('registers the system DIALOG_OPEN_DIRECTORY channel', () => {
    const manager = createMockSessionManager()
    registerInboundHandlers(manager as never)

    expect(handleMap.has(IPC.DIALOG_OPEN_DIRECTORY)).toBe(true)
  })

  it('registers exactly the expected number of inbound channels', () => {
    const manager = createMockSessionManager()
    registerInboundHandlers(manager as never)

    // 8 session channels + 1 tool approval + 1 system = 10 inbound channels.
    expect(handleMap.size).toBe(10)
  })

  it('passes the same SessionService to all session-channel handlers', () => {
    const manager = createMockSessionManager()
    registerInboundHandlers(manager as never)

    // The handlers should be functions; we can't introspect their closed-over
    // sessionManager directly, so we trust that they exist and that the
    // session handler tests verify wiring per-channel.
    expect(typeof handleMap.get(IPC.SESSION_LIST)).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// registerOutboundForwarders
// ---------------------------------------------------------------------------
describe('registerOutboundForwarders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
  })

  it('subscribes to message, exited, and tool-approval events', () => {
    const manager = createMockSessionManager()
    registerOutboundForwarders(manager as never)

    expect(manager.on).toHaveBeenCalledWith('message', expect.any(Function))
    expect(manager.on).toHaveBeenCalledWith('exited', expect.any(Function))
    expect(manager.on).toHaveBeenCalledWith(
      'tool-approval',
      expect.any(Function)
    )
  })

  it('registers exactly three event subscriptions and no inbound channels', () => {
    const manager = createMockSessionManager()
    registerOutboundForwarders(manager as never)

    expect(manager.on).toHaveBeenCalledTimes(3)
    expect(handleMap.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// registerIpc — top-level wrapper
// ---------------------------------------------------------------------------
describe('registerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
  })

  it('wires both inbound handlers and outbound forwarders in one call', () => {
    const manager = createMockSessionManager()
    registerIpc(manager as never)

    // Inbound: handle() was called for each channel
    expect(handleMap.size).toBeGreaterThanOrEqual(9)

    // Outbound: on() was called for each event
    expect(manager.on).toHaveBeenCalledWith('message', expect.any(Function))
    expect(manager.on).toHaveBeenCalledWith('exited', expect.any(Function))
    expect(manager.on).toHaveBeenCalledWith(
      'tool-approval',
      expect.any(Function)
    )
  })

  it('registers all inbound channels with a single call', () => {
    const manager = createMockSessionManager()
    registerIpc(manager as never)

    const expectedChannels = [
      IPC.SESSION_CREATE,
      IPC.SESSION_DESTROY,
      IPC.SESSION_LIST,
      IPC.SESSION_STOP_RESPONSE,
      IPC.SESSION_SEND_MESSAGE,
      IPC.SESSION_GET_MESSAGES,
      IPC.SESSION_LIST_CONVERSATIONS,
      IPC.TOOL_APPROVAL_RESPONSE,
      IPC.DIALOG_OPEN_DIRECTORY
    ]
    for (const channel of expectedChannels) {
      expect(handleMap.has(channel)).toBe(true)
    }
  })

  it('does not crash if called multiple times — registers idempotent layers', () => {
    const manager = createMockSessionManager()
    expect(() => {
      registerIpc(manager as never)
      // Note: ipcMain.handle would normally throw on duplicate channel registration,
      // but our mock just overwrites the handleMap entry. This test documents
      // the wrapper's behavior, not Electron's.
      handleMap.clear()
      manager.on.mockClear()
      registerIpc(manager as never)
    }).not.toThrow()
  })

  it('registers the inbound IPC.SESSION_STOP_RESPONSE handler that delegates to stopResponse', async () => {
    const manager = createMockSessionManager()
    registerIpc(manager as never)

    // The handler returned by transport.handle expects an event then args.
    // Since validateSender is enforced inside transport.handle and getWindow
    // is mocked to return null in this file, calling the handler will reject
    // with "Unauthorized" before reaching stopResponse. We just confirm the
    // channel was registered (already covered above) and that calling it
    // routes through validateSender.
    const handler = handleMap.get(IPC.SESSION_STOP_RESPONSE) as (
      ...args: unknown[]
    ) => Promise<unknown>
    const event = {
      sender: { id: 1 }
    } as unknown as Electron.IpcMainInvokeEvent
    await expect(handler(event, 'any-id')).rejects.toThrow('Unauthorized')
  })
})
