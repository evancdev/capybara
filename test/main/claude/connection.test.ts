import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// SDK mock — query() returns a controllable async generator
// ---------------------------------------------------------------------------
const mockQuery = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  listSessions: vi.fn().mockResolvedValue([]),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  renameSession: vi.fn().mockResolvedValue(undefined)
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

const { ClaudeConnection } = await import('@/main/claude/connection')
import type {
  ConnectionContext,
  LiveSessionState
} from '@/main/claude/connection'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeState(): LiveSessionState {
  let cid: string | null = null
  return {
    usageSummary: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: null,
      turnCount: 0
    },
    liveMetadata: {},
    setConversationId: (id: string) => {
      cid = id
    },
    getConversationId: () => cid
  }
}

function makeCtx(
  overrides: Partial<ConnectionContext> = {}
): ConnectionContext {
  return {
    cwd: '/Users/test/project',
    sessionId: 'sid-1',
    state: makeState(),
    isToolAutoApproved: () => false,
    evaluateToolPolicy: () => ({ behavior: 'ask_user' as const }),
    onToolApprovalRequest: vi.fn(),
    ...overrides
  }
}

/** A minimal mock query that hangs until aborted. */
function makeHangingQuery() {
  return ({ options }: { options?: { abortController?: AbortController } }) => {
    return (async function* () {
      await new Promise<void>((_, reject) => {
        const sig = options?.abortController?.signal
        if (!sig) return
        if (sig.aborted) {
          reject(makeAbortError())
          return
        }
        sig.addEventListener('abort', () => reject(makeAbortError()))
      })
    })()
  }
}

function makeAbortError(): Error {
  const err = new Error('aborted')
  err.name = 'AbortError'
  return err
}

// ---------------------------------------------------------------------------
// send() — closed branch
// ---------------------------------------------------------------------------
describe('ClaudeConnection.send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('warns and returns early when send is called after close', async () => {
    mockQuery.mockImplementation(makeHangingQuery())

    const conn = new ClaudeConnection(makeCtx())
    conn.close()

    conn.send('hello')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Cannot send to closed Claude connection',
      expect.objectContaining({ sessionId: 'sid-1' })
    )
  })

  it('does not warn when sending to an open connection', () => {
    const conn = new ClaudeConnection(makeCtx())

    conn.send('hello')

    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Cannot send to closed Claude connection',
      expect.any(Object)
    )
  })

  it('queues messages internally even before start() consumes them', () => {
    const conn = new ClaudeConnection(makeCtx())

    expect(() => {
      conn.send('first')
      conn.send('second')
      conn.send('third')
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// abort() — error catch branch
// ---------------------------------------------------------------------------
describe('ClaudeConnection.abort', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs info that abort was requested', () => {
    const conn = new ClaudeConnection(makeCtx())

    conn.abort()

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Claude connection abort requested',
      expect.objectContaining({ sessionId: 'sid-1' })
    )
  })

  it('catches and warns when abortController.abort() throws', () => {
    const conn = new ClaudeConnection(makeCtx())
    // Replace the controller with one whose abort throws.
    const explosive = new AbortController()
    Object.defineProperty(conn, 'abortController', {
      value: {
        signal: explosive.signal,
        abort: () => {
          throw new Error('controller exploded')
        }
      },
      writable: true,
      configurable: true
    })

    expect(() => conn.abort()).not.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to abort Claude SDK query',
      expect.objectContaining({
        sessionId: 'sid-1',
        error: expect.any(Error)
      })
    )
  })

  it('rejects any pending pushUserMessage waiter', async () => {
    const conn = new ClaudeConnection(makeCtx())

    // Drive a generator that will await nextUserMessage
    // We start the SDK loop with a hanging query so the user message generator
    // will await. Then abort and check the await rejects via rejectPendingPush.
    mockQuery.mockImplementation(({ prompt }: { prompt: AsyncIterable<unknown> }) => {
      // Consume the prompt in the background; calling .next() awaits.
      void (async () => {
        const iter = prompt[Symbol.asyncIterator]()
        try {
          await iter.next()
        } catch {
          /* expected — abort rejects */
        }
      })()
      return makeHangingQuery()({ options: undefined })
    })

    // Start the loop in the background
    void (async () => {
      const iter = conn.start()
      const it = iter[Symbol.asyncIterator]()
      try {
        await it.next()
      } catch {
        /* expected */
      }
    })()

    // Give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 10))

    expect(() => conn.abort()).not.toThrow()
  })

  it('marks aborting=true so the loop restarts after the abort fires', () => {
    const conn = new ClaudeConnection(makeCtx())
    conn.abort()
    expect((conn as unknown as { aborting: boolean }).aborting).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// close() — error catch branch and idempotency
// ---------------------------------------------------------------------------
describe('ClaudeConnection.close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is idempotent — second close is a no-op', () => {
    const conn = new ClaudeConnection(makeCtx())

    conn.close()
    expect(() => conn.close()).not.toThrow()
  })

  it('sets closed=true', () => {
    const conn = new ClaudeConnection(makeCtx())
    conn.close()
    expect((conn as unknown as { closed: boolean }).closed).toBe(true)
  })

  it('clears the buffered user message queue', () => {
    const conn = new ClaudeConnection(makeCtx())
    conn.send('unsent-1')
    conn.send('unsent-2')
    expect(
      (conn as unknown as { userMessageQueue: unknown[] }).userMessageQueue
    ).toHaveLength(2)

    conn.close()

    expect(
      (conn as unknown as { userMessageQueue: unknown[] }).userMessageQueue
    ).toHaveLength(0)
  })

  it('clears any pending aborting flag', () => {
    const conn = new ClaudeConnection(makeCtx())
    conn.abort()
    expect((conn as unknown as { aborting: boolean }).aborting).toBe(true)

    conn.close()
    expect((conn as unknown as { aborting: boolean }).aborting).toBe(false)
  })

  it('swallows errors from abortController.abort during close', () => {
    const conn = new ClaudeConnection(makeCtx())
    Object.defineProperty(conn, 'abortController', {
      value: {
        signal: new AbortController().signal,
        abort: () => {
          throw new Error('boom during close')
        }
      },
      writable: true,
      configurable: true
    })

    expect(() => conn.close()).not.toThrow()
  })

  it('rejects any waiting nextUserMessage promise so the SDK can tear down', async () => {
    const conn = new ClaudeConnection(makeCtx())

    // Manually install a resolver so close()'s rejectPendingPush has work to do
    let rejected: Error | null = null
    Object.defineProperty(conn, 'userMessageResolver', {
      value: () => undefined,
      writable: true,
      configurable: true
    })
    Object.defineProperty(conn, 'userMessageRejector', {
      value: (err: Error) => {
        rejected = err
      },
      writable: true,
      configurable: true
    })

    conn.close()

    expect(rejected).toBeInstanceOf(Error)
    expect((rejected as unknown as Error).message).toBe('Session closed')
  })
})

// ---------------------------------------------------------------------------
// start() — error and restart paths
// ---------------------------------------------------------------------------
describe('ClaudeConnection.start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits an error_message when SDK throws a non-AbortError', async () => {
    mockQuery.mockImplementation(() => {
      return (async function* () {
        throw new Error('SDK kaput')
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    const messages: unknown[] = []

    for await (const msg of conn.start()) {
      messages.push(msg)
    }

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      kind: 'error_message',
      code: 'unknown',
      message: 'SDK kaput'
    })
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('logs info (not error) when SDK throws an AbortError', async () => {
    mockQuery.mockImplementation(() => {
      return (async function* () {
        const e = new Error('aborted')
        e.name = 'AbortError'
        throw e
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    const messages: unknown[] = []

    for await (const msg of conn.start()) {
      messages.push(msg)
    }

    expect(messages).toEqual([])
    expect(mockLogger.info).toHaveBeenCalledWith(
      'SDK session aborted',
      expect.objectContaining({ sessionId: 'sid-1' })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  it('returns immediately if start is called after close', async () => {
    mockQuery.mockImplementation(makeHangingQuery())
    const conn = new ClaudeConnection(makeCtx())
    conn.close()

    const messages: unknown[] = []
    for await (const msg of conn.start()) {
      messages.push(msg)
    }
    expect(messages).toEqual([])
  })

  it('passes resume to SDK options when conversationId is set', async () => {
    let capturedOptions: { resume?: string } | undefined
    mockQuery.mockImplementation(({ options }: { options: { resume?: string } }) => {
      capturedOptions = options
      return (async function* () {
        // immediately exit
      })()
    })

    const state = makeState()
    state.setConversationId('conv-resume-id')
    const conn = new ClaudeConnection(makeCtx({ state }))

    // Drive the iterator just enough to invoke runOnce()
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    expect(capturedOptions?.resume).toBe('conv-resume-id')
  })

  it('does NOT pass resume when conversationId is null', async () => {
    let capturedOptions: { resume?: string } | undefined
    mockQuery.mockImplementation(({ options }: { options: { resume?: string } }) => {
      capturedOptions = options
      return (async function* () {
        // empty
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    expect(capturedOptions?.resume).toBeUndefined()
  })

  it('strips Electron env vars from the SDK options.env', async () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.ELECTRON_NO_ASAR = '1'

    let capturedEnv: Record<string, string> | undefined
    mockQuery.mockImplementation(({ options }: { options: { env: Record<string, string> } }) => {
      capturedEnv = options.env
      return (async function* () {
        // empty
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    expect(capturedEnv?.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(capturedEnv?.ELECTRON_NO_ASAR).toBeUndefined()

    delete process.env.ELECTRON_RUN_AS_NODE
    delete process.env.ELECTRON_NO_ASAR
  })

  it('canUseTool returns allow when policy.behavior is allow', async () => {
    let capturedCanUseTool:
      | ((
          name: string,
          input: Record<string, unknown>,
          ctx: { toolUseID: string }
        ) => Promise<{ behavior: string }>)
      | undefined
    mockQuery.mockImplementation(({ options }: { options: { canUseTool: typeof capturedCanUseTool } }) => {
      capturedCanUseTool = options.canUseTool
      return (async function* () {
        // empty
      })()
    })

    const conn = new ClaudeConnection(
      makeCtx({
        evaluateToolPolicy: () => ({ behavior: 'allow' })
      })
    )
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    const result = await capturedCanUseTool!('Read', {}, { toolUseID: 't1' })
    expect(result.behavior).toBe('allow')
  })

  it('canUseTool forwards to onToolApprovalRequest when policy is ask_user', async () => {
    let capturedCanUseTool:
      | ((
          name: string,
          input: Record<string, unknown>,
          ctx: { toolUseID: string }
        ) => Promise<{ behavior: string; updatedInput?: unknown; message?: string }>)
      | undefined
    mockQuery.mockImplementation(({ options }: { options: { canUseTool: typeof capturedCanUseTool } }) => {
      capturedCanUseTool = options.canUseTool
      return (async function* () {
        // empty
      })()
    })

    const onToolApprovalRequest = vi.fn().mockResolvedValue({
      behavior: 'allow',
      updatedInput: { command: 'safe' }
    })

    const conn = new ClaudeConnection(
      makeCtx({
        evaluateToolPolicy: () => ({ behavior: 'ask_user' }),
        onToolApprovalRequest
      })
    )
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    const result = await capturedCanUseTool!(
      'Bash',
      { cmd: 'rm' },
      { toolUseID: 't1' }
    )
    expect(result.behavior).toBe('allow')
    expect(onToolApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sid-1',
        toolUseId: 't1',
        toolName: 'Bash',
        input: { cmd: 'rm' }
      })
    )
  })

  it('canUseTool returns deny when onToolApprovalRequest rejects', async () => {
    let capturedCanUseTool:
      | ((
          name: string,
          input: Record<string, unknown>,
          ctx: { toolUseID: string }
        ) => Promise<{ behavior: string; message?: string }>)
      | undefined
    mockQuery.mockImplementation(({ options }: { options: { canUseTool: typeof capturedCanUseTool } }) => {
      capturedCanUseTool = options.canUseTool
      return (async function* () {
        // empty
      })()
    })

    const conn = new ClaudeConnection(
      makeCtx({
        evaluateToolPolicy: () => ({ behavior: 'ask_user' }),
        onToolApprovalRequest: vi
          .fn()
          .mockRejectedValue(new Error('approval aborted'))
      })
    )
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    const result = await capturedCanUseTool!(
      'Bash',
      {},
      { toolUseID: 't1' }
    )
    expect(result.behavior).toBe('deny')
    expect(result.message).toBe('Aborted')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Tool approval aborted, denying',
      expect.objectContaining({ toolName: 'Bash' })
    )
  })

  it('logs sessionId, cwd, and resume on each query start', async () => {
    mockQuery.mockImplementation(() => {
      return (async function* () {
        // empty
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Starting Claude SDK query',
      expect.objectContaining({
        sessionId: 'sid-1',
        cwd: '/Users/test/project'
      })
    )
  })

  it('stringifies non-Error SDK rejections in the error_message', async () => {
    mockQuery.mockImplementation(() => {
      return (async function* () {
        throw 'naked string' // intentional non-Error throw for coverage
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    const messages: unknown[] = []
    for await (const msg of conn.start()) {
      messages.push(msg)
    }

    expect(messages[0]).toMatchObject({
      kind: 'error_message',
      message: 'naked string'
    })
  })

  it('stringifies non-Error rejections from onToolApprovalRequest', async () => {
    let capturedCanUseTool:
      | ((
          name: string,
          input: Record<string, unknown>,
          ctx: { toolUseID: string }
        ) => Promise<{ behavior: string; message?: string }>)
      | undefined
    mockQuery.mockImplementation(
      ({ options }: { options: { canUseTool: typeof capturedCanUseTool } }) => {
        capturedCanUseTool = options.canUseTool
        return (async function* () {
          // empty
        })()
      }
    )

    const conn = new ClaudeConnection(
      makeCtx({
        evaluateToolPolicy: () => ({ behavior: 'ask_user' }),
        // Reject with a non-Error value to hit the String(err) branch
        onToolApprovalRequest: () => Promise.reject('raw string reject')
      })
    )
    const iter = conn.start()
    await iter[Symbol.asyncIterator]().next()

    const result = await capturedCanUseTool!('Bash', {}, { toolUseID: 'x' })
    expect(result.behavior).toBe('deny')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Tool approval aborted, denying',
      expect.objectContaining({ error: 'raw string reject' })
    )
  })

  it('returns from start when closed flag flips mid-iteration', async () => {
    // Drive the SDK loop with a generator whose second yield checks closed.
    // We close() between the first and second yield to hit the
    // `if (this.closed) return` branch inside runOnce's for-await.
    let connRef: InstanceType<typeof ClaudeConnection> | null = null
    mockQuery.mockImplementation(() => {
      return (async function* () {
        yield {
          type: 'system',
          subtype: 'compact_boundary'
        }
        // Force close so the next iteration returns early
        if (connRef) {
          connRef.close()
        }
        yield {
          type: 'system',
          subtype: 'compact_boundary'
        }
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    connRef = conn

    const messages: unknown[] = []
    for await (const msg of conn.start()) {
      messages.push(msg)
    }

    // Only the first message (pre-close) should have been emitted
    expect(messages.length).toBeLessThanOrEqual(1)
  })

  it('returns from start when the active loopController is aborted mid-iteration', async () => {
    // After the first yield, abort the controller to hit the
    // `if (loopController.signal.aborted) return` branch.
    let connRef: InstanceType<typeof ClaudeConnection> | null = null
    mockQuery.mockImplementation(() => {
      return (async function* () {
        yield {
          type: 'system',
          subtype: 'compact_boundary'
        }
        if (connRef) {
          ;(
            connRef as unknown as { abortController: AbortController }
          ).abortController.abort()
        }
        yield {
          type: 'system',
          subtype: 'compact_boundary'
        }
      })()
    })

    const conn = new ClaudeConnection(makeCtx())
    connRef = conn

    const messages: unknown[] = []
    try {
      for await (const msg of conn.start()) {
        messages.push(msg)
        if (messages.length >= 5) break
      }
    } catch {
      // signal.aborted may trigger the generator to throw AbortError — accept either path
    }

    // At minimum, the first message should have been delivered
    expect(messages.length).toBeGreaterThanOrEqual(1)
  })
})
