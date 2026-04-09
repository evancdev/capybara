import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const sendToRendererCalls: unknown[][] = []
const mockSendToRenderer = vi.fn((...args: unknown[]) => {
  sendToRendererCalls.push(args)
})

vi.mock('@/main/ipc/transport', () => ({
  handle: vi.fn(),
  sendToRenderer: (...args: unknown[]) => {
    mockSendToRenderer(...args)
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

// Import after mocks
const { forwardSessionEvents } = await import('@/main/ipc/outbound/session')
const { IPC } = await import('@/shared/types/constants')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSessionManager() {
  return {
    on: vi.fn(),
    emit: vi.fn()
  }
}

function getRegisteredCallback(
  onMock: ReturnType<typeof vi.fn>,
  eventName: string
): (...args: never[]) => void {
  const call = onMock.mock.calls.find((c: unknown[]) => c[0] === eventName)
  if (!call) {
    throw new Error(`No handler registered for event "${eventName}"`)
  }
  return call[1] as (...args: never[]) => void
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('forwardSessionEvents', () => {
  let manager: ReturnType<typeof createMockSessionManager>

  beforeEach(() => {
    vi.clearAllMocks()
    sendToRendererCalls.length = 0
    manager = createMockSessionManager()
  })

  it('registers listener for message events', () => {
    forwardSessionEvents(manager as never)
    expect(manager.on).toHaveBeenCalledWith('message', expect.any(Function))
  })

  it('registers listener for exited events', () => {
    forwardSessionEvents(manager as never)
    expect(manager.on).toHaveBeenCalledWith('exited', expect.any(Function))
  })

  it('registers listener for tool-approval events', () => {
    forwardSessionEvents(manager as never)
    expect(manager.on).toHaveBeenCalledWith(
      'tool-approval',
      expect.any(Function)
    )
  })

  it('forwards message events to renderer via sendToRenderer', () => {
    forwardSessionEvents(manager as never)

    const messageCallback = getRegisteredCallback(manager.on, 'message') as (
      sessionId: string,
      message: unknown
    ) => void

    const mockMessage = { kind: 'system_message', sessionId: 'sid' }
    messageCallback('sid', mockMessage)

    expect(sendToRendererCalls).toHaveLength(1)
    expect(sendToRendererCalls[0]).toEqual([
      IPC.SESSION_MESSAGE,
      'sid',
      mockMessage
    ])
  })

  it('forwards exited events to renderer via sendToRenderer', () => {
    forwardSessionEvents(manager as never)

    const exitCallback = getRegisteredCallback(manager.on, 'exited') as (
      sessionId: string,
      exitCode: number
    ) => void

    exitCallback('sid', 0)

    expect(sendToRendererCalls).toHaveLength(1)
    expect(sendToRendererCalls[0]).toEqual([IPC.SESSION_EXITED, 'sid', 0])
  })

  it('forwards tool-approval events to renderer via sendToRenderer', () => {
    forwardSessionEvents(manager as never)

    const approvalCallback = getRegisteredCallback(
      manager.on,
      'tool-approval'
    ) as (req: {
      sessionId: string
      toolUseId: string
      toolName: string
      input: Record<string, unknown>
      title?: string
      description?: string
      reason?: string
    }) => void

    approvalCallback({
      sessionId: 'sid',
      toolUseId: 'tool-123',
      toolName: 'Write',
      input: { file: 'test.ts' },
      title: 'Write file',
      description: 'Writes to test.ts',
      reason: 'File modification'
    })

    expect(sendToRendererCalls).toHaveLength(1)
    expect(sendToRendererCalls[0]).toEqual([
      IPC.TOOL_APPROVAL_REQUEST,
      {
        sessionId: 'sid',
        toolUseId: 'tool-123',
        toolName: 'Write',
        input: { file: 'test.ts' },
        timeoutMs: 120_000,
        title: 'Write file',
        description: 'Writes to test.ts',
        reason: 'File modification'
      }
    ])
  })
})
