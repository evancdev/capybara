import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach
} from 'vitest'
import {
  FakeClaudeConnection,
  fakeConnections,
  latestFakeConnection
} from '../../fixtures/fake-connection'
import { SessionNotFoundError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// Mock the Claude connection module so SessionService constructs a fake
// connection we can drive from tests.
// ---------------------------------------------------------------------------
vi.mock('@/main/claude/connection', () => ({
  ClaudeConnection: function MockClaudeConnection(ctx: unknown) {
    const conn = new FakeClaudeConnection(ctx as never)
    fakeConnections.push(conn)
    return conn as never
  }
}))

// Mock history so create(...) doesn't hit the SDK.
const mockListConversations = vi.fn().mockResolvedValue([])
const mockLoadConversationMessages = vi.fn().mockResolvedValue([])
const mockRenameConversation = vi.fn().mockResolvedValue(undefined)
vi.mock('@/main/claude/history', () => ({
  listConversations: (...args: unknown[]) =>
    mockListConversations(...args) as unknown,
  loadConversationMessages: (...args: unknown[]) =>
    mockLoadConversationMessages(...args) as unknown,
  renameConversation: (...args: unknown[]) =>
    mockRenameConversation(...args) as unknown
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({
  logger: mockLogger
}))

const { SessionService } = await import('@/main/services/session')
const { ClaudeConnection } = await import('@/main/claude/connection')
const claudeHistory = await import('@/main/claude/history')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_CWD = '/Users/test/project'

function createService(): InstanceType<typeof SessionService> {
  return new SessionService({
    connectionFactory: (ctx) => new ClaudeConnection(ctx),
    conversations: {
      listConversations: claudeHistory.listConversations,
      loadConversationMessages: claudeHistory.loadConversationMessages,
      renameConversation: claudeHistory.renameConversation
    }
  })
}

function resetFakes(): void {
  fakeConnections.length = 0
  // Re-establish defaults in case a previous test's afterEach restored them.
  mockListConversations.mockReset().mockResolvedValue([])
  mockLoadConversationMessages.mockReset().mockResolvedValue([])
  mockRenameConversation.mockReset().mockResolvedValue(undefined)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SessionService — connection close error paths', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs an error when destroy()s connection.close throws', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    const conn = latestFakeConnection()
    conn.close = vi.fn().mockImplementation(() => {
      throw new Error('close failed')
    })

    service.destroy(descriptor.id)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Claude connection close failed',
      expect.objectContaining({
        sessionId: descriptor.id,
        error: 'close failed'
      })
    )
  })

  it('stringifies non-Error throws during destroy() close', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    const conn = latestFakeConnection()
    conn.close = vi.fn().mockImplementation(() => {
      throw 'plain string failure'
    })

    service.destroy(descriptor.id)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Claude connection close failed',
      expect.objectContaining({ error: 'plain string failure' })
    )
  })

  it('logs an error when destroyAll()s connection.close throws', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    const conn = latestFakeConnection()
    conn.close = vi.fn().mockImplementation(() => {
      throw new Error('shutdown failure')
    })

    service.destroyAll()

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Claude connection close failed',
      expect.objectContaining({
        sessionId: descriptor.id,
        error: 'shutdown failure'
      })
    )
  })

  it('continues destroying other sessions even when one close throws', async () => {
    const service = createService()
    const d1 = await service.create('/Users/test/p1')
    const d2 = await service.create('/Users/test/p2')

    const conn1 = fakeConnections[0]
    conn1.close = vi.fn().mockImplementation(() => {
      throw new Error('first failed')
    })

    service.destroyAll()

    expect(service.list()).toHaveLength(0)
    expect(() => service.getMessages(d1.id)).toThrow(SessionNotFoundError)
    expect(() => service.getMessages(d2.id)).toThrow(SessionNotFoundError)
  })
})

describe('SessionService — stopResponse', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('throws SessionNotFoundError for unknown session', () => {
    const service = createService()
    expect(() => service.stopResponse('does-not-exist')).toThrow(
      SessionNotFoundError
    )
  })

  it('calls connection.abort() for the matching session', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    service.stopResponse(descriptor.id)

    const conn = latestFakeConnection()
    expect(conn.abortCalls).toBe(1)
  })

  it('logs the stop request with sessionId and currentStatus', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    service.stopResponse(descriptor.id)

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Stop response requested',
      expect.objectContaining({
        sessionId: descriptor.id,
        currentStatus: 'running'
      })
    )
  })

  it('does not delete the session — connection stays alive', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    service.stopResponse(descriptor.id)

    expect(service.list()).toHaveLength(1)
    expect(service.list()[0].id).toBe(descriptor.id)
  })

  it('can be called multiple times without error', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    expect(() => {
      service.stopResponse(descriptor.id)
      service.stopResponse(descriptor.id)
      service.stopResponse(descriptor.id)
    }).not.toThrow()

    const conn = latestFakeConnection()
    expect(conn.abortCalls).toBe(3)
  })
})

describe('SessionService — write non-running guard', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('warns and returns early when session is exited', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    conn.finish()
    await new Promise((r) => setTimeout(r, 10))

    service.write(descriptor.id, 'will be dropped')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Cannot write to non-running session',
      expect.objectContaining({ sessionId: descriptor.id })
    )
    expect(conn.sentMessages).not.toContain('will be dropped')
  })
})

describe('SessionService — clearAllPendingApprovals', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('rejects pending tool approvals when destroyAll fires', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    const conn = latestFakeConnection()

    const approvalPromise = conn.requestToolApproval({
      sessionId: descriptor.id,
      toolUseId: 'tu-pending',
      toolName: 'Bash',
      input: {}
    })

    await new Promise((r) => setTimeout(r, 5))

    service.destroyAll()

    await expect(approvalPromise).rejects.toThrow('Tool approval aborted')
  })

  it('rejects multiple pending approvals across multiple sessions', async () => {
    const service = createService()
    const d1 = await service.create('/Users/test/p1')
    const d2 = await service.create('/Users/test/p2')

    const conn1 = fakeConnections[0]
    const conn2 = fakeConnections[1]

    const p1 = conn1.requestToolApproval({
      sessionId: d1.id,
      toolUseId: 'tu1',
      toolName: 'Write',
      input: {}
    })
    const p2 = conn2.requestToolApproval({
      sessionId: d2.id,
      toolUseId: 'tu2',
      toolName: 'Edit',
      input: {}
    })

    await new Promise((r) => setTimeout(r, 5))

    service.destroyAll()

    await expect(p1).rejects.toThrow('Tool approval aborted')
    await expect(p2).rejects.toThrow('Tool approval aborted')
  })
})

describe('SessionService — requestToolApproval passthrough', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('delegates to the underlying approval broker and resolves on respond', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    const promise = service.requestToolApproval({
      sessionId: descriptor.id,
      toolUseId: 'passthrough-1',
      toolName: 'Bash',
      input: { cmd: 'ls' }
    })

    service.handleToolApprovalResponse(
      descriptor.id,
      'passthrough-1',
      'approve',
      null
    )

    const result = (await promise) as { behavior: string }
    expect(result.behavior).toBe('allow')
  })

  it('emits the tool-approval event through the broker→service pipeline', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    const events: unknown[] = []
    service.on('tool-approval', (req: unknown) => events.push(req))

    const caught = service
      .requestToolApproval({
        sessionId: descriptor.id,
        toolUseId: 'passthrough-2',
        toolName: 'Write',
        input: { file: 'test.ts' }
      })
      .catch((err: unknown) => err)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      sessionId: descriptor.id,
      toolUseId: 'passthrough-2',
      toolName: 'Write'
    })

    // Drain the dangling approval so the test exits cleanly.
    service.destroyAll()
    await caught
  })
})

describe('SessionService — tool approval timeout', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects the approval with ApprovalAbortedError after TOOL_APPROVAL_TIMEOUT_MS', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    const approvalPromise = conn.requestToolApproval({
      sessionId: descriptor.id,
      toolUseId: 'tu-timeout',
      toolName: 'Bash',
      input: {}
    })

    // Attach a rejection handler first so an immediate rejection is not
    // flagged as an unhandled promise.
    const caught = approvalPromise.catch((err: unknown) => err)

    // Fast-forward past the 120s timeout.
    await vi.advanceTimersByTimeAsync(120_001)

    const err = (await caught) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('Tool approval timed out')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Tool approval timed out',
      expect.objectContaining({
        sessionId: descriptor.id,
        toolUseId: 'tu-timeout',
        toolName: 'Bash',
        timeoutMs: 120_000
      })
    )
  })

  it('removes the pending approval from the map after timeout', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    const approvalPromise = conn.requestToolApproval({
      sessionId: descriptor.id,
      toolUseId: 'tu-timeout-2',
      toolName: 'Write',
      input: {}
    })
    const caught = approvalPromise.catch((err: unknown) => err)

    const pendingMap = (
      service as unknown as { approvals: { pending: Map<string, unknown> } }
    ).approvals.pending
    expect(pendingMap.has(`${descriptor.id}:tu-timeout-2`)).toBe(true)

    await vi.advanceTimersByTimeAsync(120_001)
    await caught

    expect(pendingMap.has(`${descriptor.id}:tu-timeout-2`)).toBe(false)
  })

  it('timer callback is a no-op when the entry was already cleared (race)', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    const approvalPromise = conn.requestToolApproval({
      sessionId: descriptor.id,
      toolUseId: 'tu-race',
      toolName: 'Bash',
      input: {}
    })
    const caught = approvalPromise.catch((err: unknown) => err)

    // Simulate a race: the entry is deleted from pendingApprovals before the
    // timer fires (e.g. by a response that slipped in just before the
    // deadline). The timer callback must early-return without logging.
    const pendingMap = (
      service as unknown as { approvals: { pending: Map<string, { reject: (e: Error) => void }> } }
    ).approvals.pending
    const entry = pendingMap.get(`${descriptor.id}:tu-race`)
    pendingMap.delete(`${descriptor.id}:tu-race`)
    // Reject the orphaned promise so the test doesn't hang.
    entry?.reject(new Error('manual teardown'))
    await caught

    mockLogger.warn.mockClear()
    await vi.advanceTimersByTimeAsync(120_001)

    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Tool approval timed out',
      expect.any(Object)
    )
  })

  it('clears the timer when the approval is resolved normally', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    const approvalPromise = conn.requestToolApproval({
      sessionId: descriptor.id,
      toolUseId: 'tu-normal',
      toolName: 'Bash',
      input: { cmd: 'ls' }
    })

    // User approves before timeout
    service.handleToolApprovalResponse(
      descriptor.id,
      'tu-normal',
      'approve',
      null
    )

    const result = (await approvalPromise) as { behavior: string }
    expect(result.behavior).toBe('allow')

    // Fast-forwarding past the timeout should NOT log "Tool approval timed out"
    // because clearTimeout was called on the response path.
    mockLogger.warn.mockClear()
    await vi.advanceTimersByTimeAsync(120_001)

    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Tool approval timed out',
      expect.any(Object)
    )
  })
})

describe('SessionService — listConversations and renameConversation', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('delegates listConversations to the claude history module', async () => {
    const stub = [
      {
        id: 'c1',
        status: 'exited' as const,
        exitCode: null,
        createdAt: 1,
        permissionMode: 'default' as const
      }
    ]
    mockListConversations.mockResolvedValueOnce(stub)
    const service = createService()

    const result = await service.listConversations('/Users/test/project')

    expect(mockListConversations).toHaveBeenCalledWith('/Users/test/project')
    expect(result).toEqual(stub)
  })

  it('delegates renameConversation with cwd', async () => {
    const service = createService()

    await service.renameConversation('c1', 'New title', '/Users/test')

    expect(mockRenameConversation).toHaveBeenCalledWith(
      'c1',
      'New title',
      '/Users/test'
    )
  })

  it('delegates renameConversation without cwd (undefined)', async () => {
    const service = createService()

    await service.renameConversation('c1', 'No cwd')

    expect(mockRenameConversation).toHaveBeenCalledWith(
      'c1',
      'No cwd',
      undefined
    )
  })
})

describe('SessionService — resume conversation pre-loads history', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('calls loadConversationMessages when resumeId is supplied', async () => {
    mockLoadConversationMessages.mockResolvedValueOnce([
      {
        kind: 'user_message',
        sessionId: 'will-be-replaced',
        text: 'prior question',
        timestamp: 1000
      }
    ])
    const service = createService()
    const descriptor = await service.create(VALID_CWD, 'prior-conv-id')

    expect(mockLoadConversationMessages).toHaveBeenCalledTimes(1)
    expect(mockLoadConversationMessages).toHaveBeenCalledWith(
      VALID_CWD,
      'prior-conv-id',
      descriptor.id
    )

    const messages = service.getMessages(descriptor.id)
    expect(messages).toHaveLength(1)
    expect(messages[0].kind).toBe('user_message')
  })

  it('passes sessionId not conversationId to loadConversationMessages', async () => {
    mockLoadConversationMessages.mockResolvedValueOnce([])
    const service = createService()
    const descriptor = await service.create(VALID_CWD, 'conv-X')
    const call = mockLoadConversationMessages.mock.calls[0]
    expect(call[2]).toBe(descriptor.id)
    expect(call[2]).not.toBe('conv-X')
  })

  it('logs the resumed history message count', async () => {
    mockLoadConversationMessages.mockResolvedValueOnce([
      { kind: 'user_message', sessionId: 's', text: 'a', timestamp: 1 },
      { kind: 'user_message', sessionId: 's', text: 'b', timestamp: 2 }
    ])
    const service = createService()
    await service.create(VALID_CWD, 'prior')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Loaded conversation history for resume',
      expect.objectContaining({
        conversationId: 'prior',
        messageCount: 2
      })
    )
  })

  it('initializes empty history bucket when no resumeId', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    expect(mockLoadConversationMessages).not.toHaveBeenCalled()
    expect(service.getMessages(descriptor.id)).toEqual([])
  })
})

describe('SessionService — internal race-condition branches', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('setConversationId is a no-op when the new id equals the current one', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD, 'same-id')

    // The mocked loadConversationMessages is called with 'same-id', which sets
    // conversationId = 'same-id' initially via `let conversationId = resumeId ?? null`.
    // Now drive the translator to call setConversationId('same-id') again — should
    // early-return without logging.
    mockLogger.info.mockClear()

    const conn = latestFakeConnection()
    const ctx = conn.ctx as {
      state: { setConversationId: (id: string) => void }
    }

    // First call matches current — should early return (no log)
    ctx.state.setConversationId('same-id')

    const capturedLog = mockLogger.info.mock.calls.find((call) =>
      String(call[0]).includes('Captured conversation ID')
    )
    expect(capturedLog).toBeUndefined()
    expect(descriptor.id).toBeDefined()
  })

  it('setConversationId logs and updates when the new id differs', async () => {
    const service = createService()
    await service.create(VALID_CWD)

    const conn = latestFakeConnection()
    const ctx = conn.ctx as {
      state: {
        setConversationId: (id: string) => void
        getConversationId: () => string | null
      }
    }

    mockLogger.info.mockClear()
    ctx.state.setConversationId('new-conversation-id')

    expect(ctx.state.getConversationId()).toBe('new-conversation-id')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Captured conversation ID',
      expect.objectContaining({ conversationId: 'new-conversation-id' })
    )
  })

  it('consumeConnection for-await breaks when destroying flag flips mid-iteration', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    // Flip destroying to true, THEN emit a message so the next() resolves
    // with a value. The for-await loop's "if (this.destroying) break" branch
    // should fire.
    ;(service as unknown as { destroying: boolean }).destroying = true

    conn.emit({
      kind: 'system_message',
      sessionId: descriptor.id,
      messageType: 'compact_boundary',
      text: 'Context window compacted'
    })
    conn.finish()

    await new Promise((r) => setTimeout(r, 10))

    // The emitted message should NOT have landed in history (because the
    // loop broke out before emitMessage). Note: history was already set to []
    // by create(). Verify it's still empty.
    const history = (
      service as unknown as { history: { store: Map<string, unknown[]> } }
    ).history.store
    // history may be undefined if destroyAll cleared it, or [] if not —
    // both outcomes are acceptable; a non-empty array is the regression we
    // want to catch.
    const stored = history.get(descriptor.id) ?? []
    expect(stored).toHaveLength(0)
  })

  it('consumeConnection for-await breaks when session is removed mid-iteration', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    // Delete the session from the map while the loop is waiting, then emit.
    ;(
      service as unknown as { sessions: Map<string, unknown> }
    ).sessions.delete(descriptor.id)

    conn.emit({
      kind: 'system_message',
      sessionId: descriptor.id,
      messageType: 'compact_boundary',
      text: 'Context window compacted'
    })
    conn.finish()

    await new Promise((r) => setTimeout(r, 10))

    // No emit should have happened on this sessionId
    expect(service.list()).toHaveLength(0)
  })

  it('handleSessionExit early-returns when the session has already been removed from the map', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    // Manually call handleSessionExit via reflection on a sessionId that
    // isn't in the map to hit the `if (!session) return` branch.
    const exitEvents: number[] = []
    service.on('exited', (_id: string, code: number) => exitEvents.push(code))
    ;(
      service as unknown as {
        handleSessionExit(id: string, code: number): void
      }
    ).handleSessionExit('ghost-session-id', 0)

    expect(exitEvents).toHaveLength(0)
    expect(descriptor).toBeDefined()
  })

  it('getMessages returns [] fallback when messageHistory entry is undefined', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)

    // Directly nuke the history bucket to simulate a race where emitMessage
    // hasn't yet lazy-initialized the bucket for this session.
    const history = (
      service as unknown as { history: { store: Map<string, unknown[]> } }
    ).history.store
    history.delete(descriptor.id)

    // Session is still in the map, so getSession() succeeds, but history.get
    // returns undefined — exercise the `?? []` fallback.
    const messages = service.getMessages(descriptor.id)
    expect(messages).toEqual([])
  })

  it('emitMessage race guard early-returns when destroying flag is set', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const history = (
      service as unknown as { history: { store: Map<string, unknown[]> } }
    ).history.store

    // Flip destroying, then call emitMessage DIRECTLY (bypassing
    // consumeConnection's own guard) to exercise the race-guard branch.
    ;(service as unknown as { destroying: boolean }).destroying = true
    ;(
      service as unknown as {
        emitMessage(id: string, msg: unknown): void
      }
    ).emitMessage(descriptor.id, {
      kind: 'system_message',
      sessionId: descriptor.id,
      messageType: 'compact_boundary',
      text: 'ignored'
    })

    // History bucket was initialized to [] by create(); the guard must prevent
    // the new message from landing in it.
    expect(history.get(descriptor.id)).toEqual([])
  })

  it('emitMessage race guard early-returns when session was removed from the map', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const history = (
      service as unknown as { history: { store: Map<string, unknown[]> } }
    ).history.store

    ;(
      service as unknown as { sessions: Map<string, unknown> }
    ).sessions.delete(descriptor.id)
    ;(
      service as unknown as {
        emitMessage(id: string, msg: unknown): void
      }
    ).emitMessage(descriptor.id, {
      kind: 'system_message',
      sessionId: descriptor.id,
      messageType: 'compact_boundary',
      text: 'ignored'
    })

    // Because the session is gone, no history entry should have been
    // lazily created for it.
    expect(history.get(descriptor.id)).toEqual([])
  })

  it('emitMessage lazily re-creates history bucket when an event arrives post-delete', async () => {
    const service = createService()
    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    // Nuke the history bucket that create() initialized.
    const history = (
      service as unknown as { history: { store: Map<string, unknown[]> } }
    ).history.store
    history.delete(descriptor.id)

    // Push a non-transient message through the connection; consumeConnection
    // will forward it to emitMessage, which must hit the lazy-init branch.
    conn.emit({
      kind: 'system_message',
      sessionId: descriptor.id,
      messageType: 'compact_boundary',
      text: 'Context window compacted'
    })

    // Wait for the for-await loop to process the event.
    await new Promise((r) => setTimeout(r, 10))

    const stored = history.get(descriptor.id)
    expect(stored).toBeDefined()
    expect(stored).toHaveLength(1)
    expect((stored as { kind: string }[])[0].kind).toBe('system_message')
  })
})

describe('SessionService — consumeConnection error path', () => {
  // Capture the pristine start method ONCE at module load so we can restore
  // it after each test. Using the prototype method directly (rather than
  // stealing it from an instance) keeps `this` binding correct for the
  // restored method.
  const originalStart = FakeClaudeConnection.prototype.start

  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
    // Always start from the pristine prototype in case an earlier failing
    // test leaked a patched version.
    FakeClaudeConnection.prototype.start = originalStart
  })

  afterEach(() => {
    FakeClaudeConnection.prototype.start = originalStart
  })

  /**
   * Patch the prototype so the NEXT instance's start() iterator rejects on
   * the first .next() call. SessionService's consumeConnection will then
   * throw inside its for-await, the finally block will run, and the
   * create().catch will fire — which is the coverage path we want.
   */
  function installFailingStart(rejectWith: unknown): void {
    FakeClaudeConnection.prototype.start = () => ({
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(rejectWith)
          }
        }
      }
    })
  }

  it('logs "Claude loop failed" and marks session exited when provider loop rejects with Error', async () => {
    installFailingStart(new Error('provider kaput'))
    const service = createService()
    const exitCodes: number[] = []
    service.on('exited', (_sid: string, code: number) => exitCodes.push(code))

    const descriptor = await service.create(VALID_CWD)
    await new Promise((r) => setTimeout(r, 20))

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Claude loop failed',
      expect.objectContaining({
        sessionId: descriptor.id,
        error: 'provider kaput'
      })
    )

    // The session should be marked exited. The exit code comes from the
    // consumeConnection finally block (0) — the catch block's
    // handleSessionExit(id, 1) is idempotent because the finally already
    // set status to 'exited'.
    expect(exitCodes.length).toBeGreaterThan(0)
    const listed = service.list().find((s) => s.id === descriptor.id)
    expect(listed?.status).toBe('exited')
  })

  it('stringifies non-Error rejections from the provider loop', async () => {
    installFailingStart('naked string rejection')
    const service = createService()
    await service.create(VALID_CWD)
    await new Promise((r) => setTimeout(r, 20))

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Claude loop failed',
      expect.objectContaining({ error: 'naked string rejection' })
    )
  })

  it('continues to accept new sessions after one provider loop failure', async () => {
    installFailingStart(new Error('first session exploded'))
    const service = createService()
    await service.create(VALID_CWD)
    await new Promise((r) => setTimeout(r, 20))

    // Restore clean behavior and create another session
    FakeClaudeConnection.prototype.start = originalStart
    const second = await service.create('/Users/test/other')
    expect(second.status).toBe('running')
  })
})

describe('SessionService — handleSessionExit idempotency', () => {
  beforeAll(() => {
    process.setMaxListeners(80)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetFakes()
  })

  it('emits exited event exactly once even if connection finishes twice', async () => {
    const service = createService()
    const exitEvents: number[] = []
    service.on('exited', (_id: string, code: number) => exitEvents.push(code))

    const descriptor = await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    conn.finish()
    await new Promise((r) => setTimeout(r, 10))

    conn.finish()
    await new Promise((r) => setTimeout(r, 10))

    expect(exitEvents).toHaveLength(1)
    expect(service.list()[0]?.status).toBe('exited')
    expect(descriptor).toBeDefined()
  })

  it('does not emit exited when service is in destroying state', async () => {
    const service = createService()
    const exitEvents: number[] = []
    service.on('exited', (_id: string, code: number) => exitEvents.push(code))

    await service.create(VALID_CWD)
    const conn = latestFakeConnection()

    service.destroyAll()
    conn.finish()
    await new Promise((r) => setTimeout(r, 10))

    expect(exitEvents).toHaveLength(0)
  })
})
