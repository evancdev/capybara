import type { SessionService } from '@/main/services/session'
import type {
  CapybaraMessage,
  ContentBlock
} from '@/shared/types/messages'
import {
  CircularInterAgentCallError,
  MaxHopsExceededError,
  TargetSessionExitedError
} from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'

/** In-flight record keyed by the target (recipient) session id. */
interface InflightRecord {
  fromSessionId: string
  toSessionId: string
  depth: number
}

/** Dependencies composed at the application root. */
export interface InterAgentRouterDeps {
  sessionService: SessionService
  /** Max depth of nested inter-agent calls in a single chain. */
  maxDepth: number
  /** How long to wait for the target's next assistant reply, in ms. */
  callTimeoutMs: number
}

/**
 * Routes `send_to_agent` tool calls between sessions.
 *
 * Responsibilities:
 *   - reject self-sends
 *   - enforce a max hop depth on chains
 *   - detect direct and transitive cycles before delivery
 *   - deliver the user turn to the target via SessionService
 *   - await the target's next text-bearing assistant reply and return its text
 *   - clean up every listener and inflight slot on every settle path
 *
 * The circular-detection map is keyed by the TARGET session id: when A calls
 * `send_to_agent(to=B)`, we insert `B → {from: A, depth}`. Subsequent calls
 * walk that chain to determine depth and detect cycles.
 */
export class InterAgentRouter {
  private inflightByTarget = new Map<string, InflightRecord>()

  constructor(private readonly deps: InterAgentRouterDeps) {}

  /**
   * Handle a single `send_to_agent` call from `fromSessionId`. Returns the
   * text of the target's next assistant reply, or throws.
   */
  async handleToolCall(
    fromSessionId: string,
    input: { to: string; content: string }
  ): Promise<string> {
    const toSessionId = input.to

    if (fromSessionId === toSessionId) {
      // Plain Error (not BaseError) — caught by MCP tool handler and converted
      // to an isError tool result. Never reaches the IPC transport.
      throw new Error('Cannot send inter-agent message to self')
    }

    // If this caller is itself a target of an in-flight call, inherit that
    // entry's depth. Otherwise we are at depth 1.
    const parent = this.inflightByTarget.get(fromSessionId)
    const depth = (parent?.depth ?? 0) + 1
    if (depth > this.deps.maxDepth) {
      throw new MaxHopsExceededError(depth)
    }

    if (this.wouldCycle(fromSessionId, toSessionId)) {
      throw new CircularInterAgentCallError(fromSessionId, toSessionId)
    }

    if (this.inflightByTarget.has(toSessionId)) {
      // Plain Error (not BaseError) — caught by MCP tool handler and converted
      // to an isError tool result. Never reaches the IPC transport.
      throw new Error(
        `Target session ${toSessionId} is already handling an inter-agent call`
      )
    }

    // Deliver synchronously before registering inflight so that a failed
    // delivery (target not found / exited) never leaves a ghost record.
    // deliverInterAgentMessage may throw SessionNotFoundError or
    // TargetSessionExitedError — propagate to the caller untouched.
    this.deps.sessionService.deliverInterAgentMessage(
      toSessionId,
      fromSessionId,
      input.content
    )

    const record: InflightRecord = { fromSessionId, toSessionId, depth }
    this.inflightByTarget.set(toSessionId, record)

    logger.info('Inter-agent call in flight', {
      fromSessionId,
      toSessionId,
      depth
    })

    try {
      return await this.waitForReply(toSessionId)
    } finally {
      // Only clear the slot if it is still ours — defensive against
      // interleaved calls that may have overwritten the entry.
      if (this.inflightByTarget.get(toSessionId) === record) {
        this.inflightByTarget.delete(toSessionId)
      }
    }
  }

  /**
   * Await the target's next text-bearing assistant reply. Resolves with the
   * extracted text, or rejects on session exit or timeout. Always detaches
   * both listeners and clears the timeout, on every settle path.
   */
  private waitForReply(targetSessionId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false

      const finish = (emit: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.deps.sessionService.off('message', onMessage)
        this.deps.sessionService.off('exited', onExited)
        emit()
      }

      const onMessage = (sid: string, msg: CapybaraMessage): void => {
        if (sid !== targetSessionId) return
        if (msg.kind !== 'assistant_message') return
        const text = this.extractText(msg.content)
        if (text.length === 0) return // skip tool-only turns
        finish(() => { resolve(text) })
      }

      const onExited = (sid: string): void => {
        if (sid !== targetSessionId) return
        finish(() => {
          reject(new TargetSessionExitedError(targetSessionId))
        })
      }

      // Plain Error (not BaseError) — caught by MCP tool handler and converted
      // to an isError tool result. Never reaches the IPC transport.
      const timeout = setTimeout(() => {
        finish(() => { reject(new Error('inter-agent call timed out')) })
      }, this.deps.callTimeoutMs)

      this.deps.sessionService.on('message', onMessage)
      this.deps.sessionService.on('exited', onExited)
    })
  }

  /**
   * Detects whether a new call `fromSessionId → toSessionId` would collide
   * with an existing in-flight chain. Runs two independent walks over
   * `inflightByTarget`, which is keyed by target with the caller stored in
   * `fromSessionId`:
   *
   *   1. Backward from the caller: starting at `fromSessionId`, follow
   *      `inflightByTarget.get(cursor)?.fromSessionId` to walk up the
   *      caller's ancestor chain. This catches DIRECT cycles where the
   *      target is already the caller's immediate (or transitive) ancestor,
   *      e.g. B→A pending and A tries to call B. In that case the back-edge
   *      lives on the caller's side, not the target's.
   *
   *   2. Forward from the target: starting at `toSessionId`, follow the
   *      same link. This catches the case where the target is itself busy
   *      handling a call whose ancestor chain leads back to the caller,
   *      e.g. A→B pending, B→C pending, A now tries to call C.
   *
   * Both walks are bounded by `visited` sets so a pre-existing corrupted
   * map never spins.
   */
  private wouldCycle(fromSessionId: string, toSessionId: string): boolean {
    // Backward walk: does toSessionId appear upstream of the caller?
    let backCursor = fromSessionId
    const backVisited = new Set<string>()
    for (;;) {
      if (backVisited.has(backCursor)) return true
      backVisited.add(backCursor)
      const entry = this.inflightByTarget.get(backCursor)
      if (!entry) break
      if (entry.fromSessionId === toSessionId) return true
      backCursor = entry.fromSessionId
    }

    // Forward walk: does the caller appear upstream of the target?
    let fwdCursor = toSessionId
    const fwdVisited = new Set<string>()
    for (;;) {
      if (fwdVisited.has(fwdCursor)) return true
      fwdVisited.add(fwdCursor)
      const entry = this.inflightByTarget.get(fwdCursor)
      if (!entry) return false
      if (entry.fromSessionId === fromSessionId) return true
      fwdCursor = entry.fromSessionId
    }
  }

  /** Join text blocks from an assistant message content array. */
  private extractText(blocks: ContentBlock[]): string {
    return blocks
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> =>
        b.type === 'text'
      )
      .map((b) => b.text)
      .join('\n')
      .trim()
  }
}
