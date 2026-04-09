import type { CapybaraMessage } from '@/shared/types/messages'

/**
 * Per-session ring buffer of CapybaraMessages. Owns the history Map and the
 * transient-kind filter so SessionService never has to touch raw storage.
 *
 * Transient kinds (tool_progress, thinking_delta) are forwarded to the
 * renderer but never persisted — they are UI-only deltas with no lasting
 * value and would blow the buffer apart in seconds if we kept them.
 */
export class MessageHistoryStore {
  private readonly store = new Map<string, CapybaraMessage[]>()
  private readonly maxPerSession: number
  private static readonly TRANSIENT_KINDS = new Set<CapybaraMessage['kind']>([
    'tool_progress',
    'thinking_delta'
  ])

  constructor(maxPerSession = 5000) {
    this.maxPerSession = maxPerSession
  }

  /** Seed a session's history (e.g. with messages loaded from disk on resume). */
  init(sessionId: string, initial: CapybaraMessage[] = []): void {
    this.store.set(sessionId, initial)
  }

  /** Returns a session's history, or [] if the session is unknown. */
  get(sessionId: string): CapybaraMessage[] {
    return this.store.get(sessionId) ?? []
  }

  /**
   * Append a message to a session's history, skipping transient kinds.
   * Lazily creates the bucket if an event arrives for a session that was
   * never init()ed (defensive — should not happen in normal flow).
   */
  append(sessionId: string, message: CapybaraMessage): void {
    if (MessageHistoryStore.TRANSIENT_KINDS.has(message.kind)) return

    let history = this.store.get(sessionId)
    if (!history) {
      history = []
      this.store.set(sessionId, history)
    }
    history.push(message)

    if (history.length > this.maxPerSession) {
      history.shift()
    }
  }

  /** Drop a single session's history. No-op if unknown. */
  delete(sessionId: string): void {
    this.store.delete(sessionId)
  }

  /** Drop every session's history. */
  clear(): void {
    this.store.clear()
  }
}
