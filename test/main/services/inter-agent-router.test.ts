import { EventEmitter } from 'events'
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach
} from 'vitest'
import { InterAgentRouter } from '@/main/services/inter-agent-router'
import type { SessionService } from '@/main/services/session'
import type { CapybaraMessage, ContentBlock } from '@/shared/types/messages'
import {
  CircularInterAgentCallError,
  MaxHopsExceededError,
  SessionNotFoundError,
  TargetSessionExitedError
} from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// Logger mock — InterAgentRouter uses it for inflight logging.
// ---------------------------------------------------------------------------
vi.mock('@/main/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

// ---------------------------------------------------------------------------
// Fake SessionService — an EventEmitter with a spy for deliverInterAgentMessage.
// Only the surface actually touched by InterAgentRouter is implemented.
// ---------------------------------------------------------------------------
class FakeSessionService extends EventEmitter {
  deliverInterAgentMessage = vi.fn(
    (_targetId: string, _fromId: string, _content: string): void => {
      // default: no-op
    }
  )
}

const SESSION_A = '11111111-1111-4111-8111-111111111111'
const SESSION_B = '22222222-2222-4222-8222-222222222222'
const SESSION_C = '33333333-3333-4333-8333-333333333333'

const CALL_TIMEOUT_MS = 300_000
const MAX_DEPTH = 5

function createRouter(
  fake: FakeSessionService,
  overrides?: { maxDepth?: number; callTimeoutMs?: number }
): InterAgentRouter {
  return new InterAgentRouter({
    sessionService: fake as unknown as SessionService,
    maxDepth: overrides?.maxDepth ?? MAX_DEPTH,
    callTimeoutMs: overrides?.callTimeoutMs ?? CALL_TIMEOUT_MS
  })
}

function textAssistantMessage(sessionId: string, text: string): CapybaraMessage {
  return {
    kind: 'assistant_message',
    sessionId,
    content: [{ type: 'text', text } satisfies ContentBlock],
    timestamp: Date.now()
  } as unknown as CapybaraMessage
}

function toolOnlyAssistantMessage(sessionId: string): CapybaraMessage {
  return {
    kind: 'assistant_message',
    sessionId,
    content: [
      {
        type: 'tool_use',
        toolUseId: 'tu_1',
        toolName: 'Read',
        input: {}
      } satisfies ContentBlock
    ],
    timestamp: Date.now()
  } as unknown as CapybaraMessage
}

describe('InterAgentRouter', () => {
  let fake: FakeSessionService

  beforeEach(() => {
    fake = new FakeSessionService()
    fake.setMaxListeners(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------
  it('delivers the call, awaits the target reply, and resolves with its text', async () => {
    const router = createRouter(fake)
    const promise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'hi'
    })

    // Allow the microtask that registered listeners to run.
    await Promise.resolve()

    expect(fake.deliverInterAgentMessage).toHaveBeenCalledTimes(1)
    expect(fake.deliverInterAgentMessage).toHaveBeenCalledWith(
      SESSION_B,
      SESSION_A,
      'hi'
    )

    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, '4'))

    await expect(promise).resolves.toBe('4')
  })

  // -------------------------------------------------------------------------
  // 2. Text-only filter — tool-only assistant messages don't resolve.
  // -------------------------------------------------------------------------
  it('ignores tool-only assistant messages and resolves on the next text-bearing one', async () => {
    const router = createRouter(fake)
    const promise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'q'
    })
    await Promise.resolve()

    // Tool-only turn first — must NOT resolve.
    fake.emit('message', SESSION_B, toolOnlyAssistantMessage(SESSION_B))

    // Give the microtask queue a chance. The promise should still be pending.
    const racer = Promise.race([
      promise.then(
        (v) => ({ settled: true as const, value: v }),
        (e: unknown) => ({ settled: true as const, error: e })
      ),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 20)
      )
    ])
    const status = await racer
    expect(status.settled).toBe(false)

    // Now a text-bearing reply arrives — should resolve.
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'answer'))
    await expect(promise).resolves.toBe('answer')
  })

  // -------------------------------------------------------------------------
  // 3. Target exits mid-wait → TargetSessionExitedError
  // -------------------------------------------------------------------------
  it('rejects with TargetSessionExitedError if the target emits exited before replying', async () => {
    const router = createRouter(fake)
    const promise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'hi'
    })
    await Promise.resolve()

    fake.emit('exited', SESSION_B, 0)

    await expect(promise).rejects.toBeInstanceOf(TargetSessionExitedError)
  })

  // -------------------------------------------------------------------------
  // 4. Direct circular — B→A inflight, A→B is a cycle.
  // -------------------------------------------------------------------------
  it('rejects a direct circular call and does not deliver the second message', { timeout: 1500 }, async () => {
    const router = createRouter(fake)

    // First call: B → A. Leave it pending so the inflight record stays set.
    const first = router.handleToolCall(SESSION_B, {
      to: SESSION_A,
      content: 'first'
    })
    await Promise.resolve()

    // Second call: A → B. This forms a direct cycle because B→A is in flight.
    await expect(
      router.handleToolCall(SESSION_A, { to: SESSION_B, content: 'second' })
    ).rejects.toBeInstanceOf(CircularInterAgentCallError)

    // Only the first delivery should have happened.
    expect(fake.deliverInterAgentMessage).toHaveBeenCalledTimes(1)
    expect(fake.deliverInterAgentMessage).toHaveBeenCalledWith(
      SESSION_A,
      SESSION_B,
      'first'
    )

    // Settle the first call so we don't leak a hanging promise.
    fake.emit('message', SESSION_A, textAssistantMessage(SESSION_A, 'ok'))
    await first
  })

  // -------------------------------------------------------------------------
  // 5. Transitive circular — B→A inflight, C→B inflight, A→C is a cycle.
  // -------------------------------------------------------------------------
  it('rejects a transitive circular call (walks the inflight chain)', async () => {
    const router = createRouter(fake)

    // Set up a chain where A→B and B→C are both in flight. The router's
    // inflightByTarget stores entries keyed by the target: B→{from:A} and
    // C→{from:B}. When A now tries to call C, wouldCycle walks from C:
    //   cursor=C → entry {from:B} → entry.fromSessionId !== A, cursor=B
    //   cursor=B → entry {from:A} → entry.fromSessionId === A → cycle.
    const callABPromise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'a->b'
    })
    await Promise.resolve()

    const callBCPromise = router.handleToolCall(SESSION_B, {
      to: SESSION_C,
      content: 'b->c'
    })
    await Promise.resolve()

    await expect(
      router.handleToolCall(SESSION_A, { to: SESSION_C, content: 'a->c' })
    ).rejects.toBeInstanceOf(CircularInterAgentCallError)

    // Cleanup — settle the two pending calls so nothing leaks.
    fake.emit('message', SESSION_C, textAssistantMessage(SESSION_C, 'done'))
    await callBCPromise
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'done'))
    await callABPromise
  })

  // -------------------------------------------------------------------------
  // 6. Max hops — chain of depth MAX_DEPTH, the next call rejects.
  // -------------------------------------------------------------------------
  it('rejects with MaxHopsExceededError when the chain depth would exceed maxDepth', async () => {
    const router = createRouter(fake, { maxDepth: 2 })

    // Build a chain: call1 A→B (depth 1, parent lookup for A → none).
    const call1 = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'hop1'
    })
    await Promise.resolve()

    // call2 B→C (B is the target of call1, so parent for caller B is A→B
    // with depth 1; new call depth = 2, which equals maxDepth and is OK).
    const call2 = router.handleToolCall(SESSION_B, {
      to: SESSION_C,
      content: 'hop2'
    })
    await Promise.resolve()

    // call3 C→A: parent for caller C is B→C (depth 2). depth would = 3 > 2.
    // MaxHops must fire before any cycle check.
    await expect(
      router.handleToolCall(SESSION_C, { to: SESSION_A, content: 'hop3' })
    ).rejects.toBeInstanceOf(MaxHopsExceededError)

    // Cleanup the two pending calls.
    fake.emit('message', SESSION_C, textAssistantMessage(SESSION_C, 'x'))
    await call2
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'x'))
    await call1
  })

  // -------------------------------------------------------------------------
  // 7. Target not found → propagate SessionNotFoundError.
  // -------------------------------------------------------------------------
  it('propagates SessionNotFoundError thrown by deliverInterAgentMessage', async () => {
    const router = createRouter(fake)
    fake.deliverInterAgentMessage.mockImplementation(() => {
      throw new SessionNotFoundError(SESSION_B)
    })

    await expect(
      router.handleToolCall(SESSION_A, { to: SESSION_B, content: 'hi' })
    ).rejects.toBeInstanceOf(SessionNotFoundError)
  })

  // -------------------------------------------------------------------------
  // 8. Self-target — rejects without calling deliverInterAgentMessage.
  // -------------------------------------------------------------------------
  it('rejects self-sends immediately and does not invoke deliverInterAgentMessage', async () => {
    const router = createRouter(fake)

    await expect(
      router.handleToolCall(SESSION_A, { to: SESSION_A, content: 'mirror' })
    ).rejects.toThrow(/self/i)

    expect(fake.deliverInterAgentMessage).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 9. Timeout — fake timers.
  // -------------------------------------------------------------------------
  it('times out after callTimeoutMs with no reply and detaches all listeners', async () => {
    vi.useFakeTimers()
    const router = createRouter(fake, { callTimeoutMs: 1000 })
    const promise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'hi'
    })
    // Allow microtask queue so listeners attach.
    await Promise.resolve()

    expect(fake.listenerCount('message')).toBe(1)
    expect(fake.listenerCount('exited')).toBe(1)

    vi.advanceTimersByTime(1000)

    await expect(promise).rejects.toThrow(/timed out/i)
    expect(fake.listenerCount('message')).toBe(0)
    expect(fake.listenerCount('exited')).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 10. Listener cleanup on success.
  // -------------------------------------------------------------------------
  it('detaches message/exited listeners after resolving successfully', async () => {
    const router = createRouter(fake)
    const promise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'hi'
    })
    await Promise.resolve()

    expect(fake.listenerCount('message')).toBe(1)
    expect(fake.listenerCount('exited')).toBe(1)

    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'ok'))
    await promise

    expect(fake.listenerCount('message')).toBe(0)
    expect(fake.listenerCount('exited')).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 11. Inflight cleanup — after success and after rejection.
  // -------------------------------------------------------------------------
  it('clears inflight state after both success and rejection so subsequent calls behave freshly', async () => {
    const router = createRouter(fake)

    // First call succeeds.
    const p1 = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'one'
    })
    await Promise.resolve()
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'r1'))
    await expect(p1).resolves.toBe('r1')

    // Second call to the same target: if inflight weren't cleared, the new
    // parent lookup would think A is still mid-chain. Instead this must
    // start at depth 1 again and succeed normally.
    const p2 = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'two'
    })
    await Promise.resolve()
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'r2'))
    await expect(p2).resolves.toBe('r2')

    // Third call: force a rejection via delivery throwing.
    fake.deliverInterAgentMessage.mockImplementationOnce(() => {
      throw new SessionNotFoundError(SESSION_B)
    })
    await expect(
      router.handleToolCall(SESSION_A, { to: SESSION_B, content: 'three' })
    ).rejects.toBeInstanceOf(SessionNotFoundError)

    // Fourth call: inflight must be clean — listeners should be zero from
    // the failed call (nothing attached because delivery threw before
    // waitForReply), and a fresh call must succeed.
    expect(fake.listenerCount('message')).toBe(0)
    expect(fake.listenerCount('exited')).toBe(0)

    const p4 = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'four'
    })
    await Promise.resolve()
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'r4'))
    await expect(p4).resolves.toBe('r4')
  })

  // -------------------------------------------------------------------------
  // 12. Concurrent same-target rejection — second caller gets an error when
  //     the target is already handling an in-flight call from another sender.
  // -------------------------------------------------------------------------
  it('rejects a second call targeting the same session while the first is still in-flight', async () => {
    const router = createRouter(fake)

    // A → B: leave pending (don't resolve).
    const firstCall = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'first'
    })
    await Promise.resolve()

    // C → B: should be rejected because B is already handling A's call.
    await expect(
      router.handleToolCall(SESSION_C, { to: SESSION_B, content: 'second' })
    ).rejects.toThrow(/already handling an inter-agent call/)

    // Only A's delivery should have occurred.
    expect(fake.deliverInterAgentMessage).toHaveBeenCalledTimes(1)
    expect(fake.deliverInterAgentMessage).toHaveBeenCalledWith(
      SESSION_B,
      SESSION_A,
      'first'
    )

    // Settle A's call so nothing leaks.
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'done'))
    await firstCall
  })

  // -------------------------------------------------------------------------
  // 13. Empty text block from target — router skips it and waits for real text.
  // -------------------------------------------------------------------------
  it('skips an assistant_message with only empty text blocks and resolves on the next real one', async () => {
    const router = createRouter(fake)
    const promise = router.handleToolCall(SESSION_A, {
      to: SESSION_B,
      content: 'question'
    })
    await Promise.resolve()

    // Target emits a message with an empty text block — router should skip.
    const emptyTextMsg = {
      kind: 'assistant_message',
      sessionId: SESSION_B,
      content: [{ type: 'text', text: '' } satisfies ContentBlock],
      timestamp: Date.now()
    } as unknown as CapybaraMessage
    fake.emit('message', SESSION_B, emptyTextMsg)

    // Verify the promise is still pending.
    const racer = Promise.race([
      promise.then(
        (v) => ({ settled: true as const, value: v }),
        (e: unknown) => ({ settled: true as const, error: e })
      ),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 20)
      )
    ])
    const status = await racer
    expect(status.settled).toBe(false)

    // Now a real text-bearing reply arrives.
    fake.emit('message', SESSION_B, textAssistantMessage(SESSION_B, 'real answer'))
    await expect(promise).resolves.toBe('real answer')
  })
})
