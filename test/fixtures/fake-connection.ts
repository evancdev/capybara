import { vi } from 'vitest'
import type { CapybaraMessage } from '@/shared/types/messages'

/**
 * Test-controllable fake standing in for ClaudeConnection. Tests push events
 * into the queue via `emit()` and call `finish()` to end the stream.
 */
export interface FakeClaudeConnectionShape {
  readonly ctx: unknown
  readonly sentMessages: string[]
  abortCalls: number
  closeCalls: number
  started: boolean
  closed: boolean
  start: () => AsyncIterable<CapybaraMessage>
  send: (text: string) => void
  abort: () => void
  close: () => Promise<void>
  emit: (message: CapybaraMessage) => void
  finish: () => void
  requestToolApproval: (req: {
    sessionId: string
    toolUseId: string
    toolName: string
    input: Record<string, unknown>
  }) => Promise<unknown>
}

interface ConnectionContextLike {
  onToolApprovalRequest?: (req: unknown) => Promise<unknown>
}

export class FakeClaudeConnection implements FakeClaudeConnectionShape {
  readonly ctx: ConnectionContextLike
  readonly sentMessages: string[] = []
  abortCalls = 0
  closeCalls = 0
  started = false
  closed = false

  private queue: CapybaraMessage[] = []
  private resolvers: ((value: IteratorResult<CapybaraMessage>) => void)[] = []
  private done = false

  constructor(ctx: ConnectionContextLike) {
    this.ctx = ctx
  }

  start(): AsyncIterable<CapybaraMessage> {
    this.started = true
    const queue = this.queue
    const resolvers = this.resolvers
    const isDone = () => this.done
    return {
      [Symbol.asyncIterator](): AsyncIterator<CapybaraMessage> {
        return {
          next(): Promise<IteratorResult<CapybaraMessage>> {
            if (queue.length > 0) {
              const value = queue.shift() as CapybaraMessage
              return Promise.resolve({ value, done: false })
            }
            if (isDone()) {
              return Promise.resolve({
                value: undefined as never,
                done: true
              })
            }
            return new Promise((resolve) => {
              resolvers.push(resolve)
            })
          }
        }
      }
    }
  }

  send(text: string): void {
    this.sentMessages.push(text)
  }

  abort(): void {
    this.abortCalls++
  }

  close = vi.fn(() => {
    this.closeCalls++
    this.closed = true
    this.finish()
    return Promise.resolve()
  })

  emit(message: CapybaraMessage): void {
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ value: message, done: false })
    } else {
      this.queue.push(message)
    }
  }

  finish(): void {
    this.done = true
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()
      if (resolver) {
        resolver({ value: undefined as never, done: true })
      }
    }
  }

  async requestToolApproval(req: {
    sessionId: string
    toolUseId: string
    toolName: string
    input: Record<string, unknown>
  }): Promise<unknown> {
    if (!this.ctx.onToolApprovalRequest) {
      throw new Error('No onToolApprovalRequest callback provided')
    }
    return this.ctx.onToolApprovalRequest(req)
  }
}

/**
 * Registry of FakeClaudeConnection instances. Tests reset this in beforeEach.
 */
export const fakeConnections: FakeClaudeConnection[] = []

/** Returns the most recently opened connection, throwing if none. */
export function latestFakeConnection(): FakeClaudeConnection {
  const last = fakeConnections[fakeConnections.length - 1] as
    | FakeClaudeConnection
    | undefined
  if (!last) {
    throw new Error('No FakeClaudeConnection has been created')
  }
  return last
}
