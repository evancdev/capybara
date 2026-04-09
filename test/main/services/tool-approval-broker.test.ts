import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ToolApprovalRequest } from '@/shared/types/messages'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

const { ToolApprovalBroker } = await import(
  '@/main/services/tool-approval-broker'
)
const { ApprovalAbortedError } = await import('@/main/services/tools')

const TIMEOUT_MS = 120_000

function makeReq(
  overrides: Partial<ToolApprovalRequest> = {}
): ToolApprovalRequest {
  return {
    sessionId: 'sid-1',
    toolUseId: 'tu-1',
    toolName: 'Bash',
    input: { cmd: 'ls' },
    ...overrides
  }
}

describe('ToolApprovalBroker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // request() — emitter + pending registration
  // -------------------------------------------------------------------------
  describe('request()', () => {
    it('emits the request upward with timeoutMs merged in', () => {
      const emit = vi.fn()
      const broker = new ToolApprovalBroker(TIMEOUT_MS, emit)

      void broker.request(makeReq())

      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sid-1',
          toolUseId: 'tu-1',
          toolName: 'Bash',
          timeoutMs: TIMEOUT_MS
        })
      )
    })

    it('registers a pending entry keyed by sessionId:toolUseId', () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      void broker.request(makeReq())

      const pending = (
        broker as unknown as { pending: Map<string, unknown> }
      ).pending
      expect(pending.has('sid-1:tu-1')).toBe(true)
    })

    it('warns when pending map reaches the warn threshold (>=50)', () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())

      // Fire 50 requests to cross the threshold.
      for (let i = 0; i < 50; i++) {
        void broker.request(
          makeReq({ sessionId: `sid-${i}`, toolUseId: `tu-${i}` })
        )
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Pending tool approval count growing',
        expect.objectContaining({ count: 50, threshold: 50 })
      )
    })

    it('does not warn below the threshold', () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())

      for (let i = 0; i < 49; i++) {
        void broker.request(
          makeReq({ sessionId: `sid-${i}`, toolUseId: `tu-${i}` })
        )
      }

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'Pending tool approval count growing',
        expect.any(Object)
      )
    })
  })

  // -------------------------------------------------------------------------
  // Timeout path
  // -------------------------------------------------------------------------
  describe('request() timeout', () => {
    it('rejects with ApprovalAbortedError("Tool approval timed out") after timeoutMs', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())

      const promise = broker.request(makeReq())
      const caught = promise.catch((err: unknown) => err)

      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)

      const err = (await caught) as Error
      expect(err).toBeInstanceOf(ApprovalAbortedError)
      expect(err.message).toBe('Tool approval timed out')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Tool approval timed out',
        expect.objectContaining({
          sessionId: 'sid-1',
          toolUseId: 'tu-1',
          toolName: 'Bash',
          timeoutMs: TIMEOUT_MS
        })
      )
    })

    it('removes the entry from pending after timeout fires', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const caught = broker.request(makeReq()).catch((err: unknown) => err)

      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)
      await caught

      const pending = (
        broker as unknown as { pending: Map<string, unknown> }
      ).pending
      expect(pending.has('sid-1:tu-1')).toBe(false)
    })

    it('timer callback is a no-op if the entry was already removed', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const caught = broker.request(makeReq()).catch((err: unknown) => err)

      // Drain entry pre-timeout, simulating a late response winning the race.
      const pending = (
        broker as unknown as {
          pending: Map<string, { reject: (e: Error) => void }>
        }
      ).pending
      const entry = pending.get('sid-1:tu-1')
      pending.delete('sid-1:tu-1')
      entry?.reject(new Error('manual teardown'))
      await caught

      mockLogger.warn.mockClear()
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'Tool approval timed out',
        expect.any(Object)
      )
    })
  })

  // -------------------------------------------------------------------------
  // respond()
  // -------------------------------------------------------------------------
  describe('respond()', () => {
    it('resolves with behavior=allow and the original input on approve', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const promise = broker.request(
        makeReq({ input: { cmd: 'echo hi' } })
      )

      broker.respond('sid-1', 'tu-1', 'approve', null)

      const result = (await promise) as {
        behavior: string
        updatedInput?: unknown
      }
      expect(result.behavior).toBe('allow')
      expect(result.updatedInput).toEqual({ cmd: 'echo hi' })
    })

    it('resolves with behavior=deny and the supplied message', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const promise = broker.request(makeReq())

      broker.respond('sid-1', 'tu-1', 'deny', 'nope, too risky')

      const result = (await promise) as { behavior: string; message: string }
      expect(result.behavior).toBe('deny')
      expect(result.message).toBe('nope, too risky')
    })

    it('defaults the deny message to `Tool "<name>" denied by user` when null', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const promise = broker.request(makeReq({ toolName: 'Write' }))

      broker.respond('sid-1', 'tu-1', 'deny', null)

      const result = (await promise) as { message: string }
      expect(result.message).toBe('Tool "Write" denied by user')
    })

    it('clears the pending-entry timer so timeout does not fire later', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const promise = broker.request(makeReq())

      broker.respond('sid-1', 'tu-1', 'approve', null)
      await promise

      mockLogger.warn.mockClear()
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1)

      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        'Tool approval timed out',
        expect.any(Object)
      )
    })

    it('removes the entry from pending after a successful response', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const promise = broker.request(makeReq())

      broker.respond('sid-1', 'tu-1', 'approve', null)
      await promise

      const pending = (
        broker as unknown as { pending: Map<string, unknown> }
      ).pending
      expect(pending.has('sid-1:tu-1')).toBe(false)
    })

    it('logs a warning and is a no-op when the key is unknown (late reply)', () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())

      broker.respond('ghost-sid', 'ghost-tu', 'approve', null)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'No pending approval found for key',
        expect.objectContaining({
          lookupKey: 'ghost-sid:ghost-tu',
          sessionId: 'ghost-sid',
          toolUseId: 'ghost-tu'
        })
      )
    })
  })

  // -------------------------------------------------------------------------
  // clearForSession()
  // -------------------------------------------------------------------------
  describe('clearForSession()', () => {
    it('rejects every pending approval belonging to the session', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const p1 = broker
        .request(makeReq({ sessionId: 'sid-A', toolUseId: 'tu-1' }))
        .catch((err: unknown) => err)
      const p2 = broker
        .request(makeReq({ sessionId: 'sid-A', toolUseId: 'tu-2' }))
        .catch((err: unknown) => err)
      const other = broker
        .request(makeReq({ sessionId: 'sid-B', toolUseId: 'tu-1' }))
        .catch((err: unknown) => err)

      broker.clearForSession('sid-A')

      const [e1, e2] = (await Promise.all([p1, p2])) as [Error, Error]
      expect(e1).toBeInstanceOf(ApprovalAbortedError)
      expect(e2).toBeInstanceOf(ApprovalAbortedError)

      // Other session's entry is still pending.
      const pending = (
        broker as unknown as { pending: Map<string, unknown> }
      ).pending
      expect(pending.has('sid-B:tu-1')).toBe(true)

      // Clean up
      broker.clearAll()
      await other
    })

    it('is a no-op when no entries match the session prefix', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const caught = broker
        .request(makeReq({ sessionId: 'sid-A', toolUseId: 'tu-1' }))
        .catch((err: unknown) => err)

      expect(() => broker.clearForSession('sid-B')).not.toThrow()

      const pending = (
        broker as unknown as { pending: Map<string, unknown> }
      ).pending
      expect(pending.has('sid-A:tu-1')).toBe(true)

      broker.clearAll()
      await caught
    })
  })

  // -------------------------------------------------------------------------
  // clearAll()
  // -------------------------------------------------------------------------
  describe('clearAll()', () => {
    it('rejects every pending approval and empties the map', async () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      const p1 = broker
        .request(makeReq({ sessionId: 'sid-A', toolUseId: 'tu-1' }))
        .catch((err: unknown) => err)
      const p2 = broker
        .request(makeReq({ sessionId: 'sid-B', toolUseId: 'tu-2' }))
        .catch((err: unknown) => err)

      broker.clearAll()

      const [e1, e2] = (await Promise.all([p1, p2])) as [Error, Error]
      expect(e1).toBeInstanceOf(ApprovalAbortedError)
      expect(e2).toBeInstanceOf(ApprovalAbortedError)

      const pending = (
        broker as unknown as { pending: Map<string, unknown> }
      ).pending
      expect(pending.size).toBe(0)
    })

    it('is safe to call on an empty broker', () => {
      const broker = new ToolApprovalBroker(TIMEOUT_MS, vi.fn())
      expect(() => broker.clearAll()).not.toThrow()
    })
  })
})
