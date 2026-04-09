import type {
  PermissionResult
} from '@/main/claude/connection'
import type { ToolApprovalRequest } from '@/shared/types/messages'
import { ApprovalAbortedError } from '@/main/services/tools'
import { logger } from '@/main/lib/logger'

/** Threshold at which we warn about unusual pending-approval growth. */
const PENDING_APPROVALS_WARN_THRESHOLD = 50

interface PendingApproval {
  resolve: (result: PermissionResult) => void
  reject: (err: Error) => void
  input: Record<string, unknown>
  toolName: string
  timer: NodeJS.Timeout
}

/** Callback the broker uses to push request events upward to the IPC layer. */
export type ApprovalRequestEmitter = (request: ToolApprovalRequest) => void

/**
 * Owns the pending-tool-approval map. Handles timeout, per-session and
 * global cancellation, and normal resolve/reject paths. Extracted from
 * SessionService so its lifecycle is testable in isolation and the service
 * does not double as both session registry and approval broker.
 *
 * The broker does not know anything about EventEmitter. The service wires
 * an emitter callback at construction time so the broker only pushes
 * serializable ToolApprovalRequest payloads outward — no tight coupling.
 */
export class ToolApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>()
  private readonly timeoutMs: number
  private readonly emit: ApprovalRequestEmitter

  constructor(timeoutMs: number, emit: ApprovalRequestEmitter) {
    this.timeoutMs = timeoutMs
    this.emit = emit
  }

  /**
   * Register a pending approval, push the request outward via the injected
   * emitter, and return the Promise the caller awaits. A timer rejects the
   * Promise with ApprovalAbortedError after `timeoutMs` so a crashed or
   * non-responsive renderer never wedges the SDK's canUseTool callback.
   */
  request(req: ToolApprovalRequest): Promise<PermissionResult> {
    return new Promise((resolve, reject) => {
      const key = this.keyOf(req.sessionId, req.toolUseId)
      const timer = setTimeout(() => {
        const entry = this.pending.get(key)
        if (!entry) return
        this.pending.delete(key)
        logger.warn('Tool approval timed out', {
          sessionId: req.sessionId,
          toolUseId: req.toolUseId,
          toolName: req.toolName,
          timeoutMs: this.timeoutMs
        })
        entry.reject(new ApprovalAbortedError('Tool approval timed out'))
      }, this.timeoutMs)
      timer.unref()

      this.pending.set(key, {
        resolve,
        reject,
        input: req.input,
        toolName: req.toolName,
        timer
      })

      if (this.pending.size >= PENDING_APPROVALS_WARN_THRESHOLD) {
        logger.warn('Pending tool approval count growing', {
          count: this.pending.size,
          threshold: PENDING_APPROVALS_WARN_THRESHOLD
        })
      }

      this.emit({ ...req, timeoutMs: this.timeoutMs })
    })
  }

  /**
   * Resolve a pending approval from the renderer's response. If no pending
   * entry exists (late reply after timeout/cancel), logs and returns.
   */
  respond(
    sessionId: string,
    toolUseId: string,
    decision: 'approve' | 'deny',
    message: string | null
  ): void {
    const key = this.keyOf(sessionId, toolUseId)
    const entry = this.pending.get(key)
    if (!entry) {
      logger.warn('No pending approval found for key', {
        lookupKey: key,
        sessionId,
        toolUseId,
        pendingKeys: Array.from(this.pending.keys())
      })
      return
    }
    clearTimeout(entry.timer)
    this.pending.delete(key)
    if (decision === 'approve') {
      entry.resolve({ behavior: 'allow', updatedInput: entry.input })
    } else {
      entry.resolve({
        behavior: 'deny',
        message: message ?? `Tool "${entry.toolName}" denied by user`
      })
    }
  }

  /** Reject every pending approval belonging to the given session. */
  clearForSession(sessionId: string): void {
    const prefix = `${sessionId}:`
    for (const key of Array.from(this.pending.keys())) {
      if (!key.startsWith(prefix)) continue
      const entry = this.pending.get(key)
      this.pending.delete(key)
      if (entry) {
        clearTimeout(entry.timer)
        entry.reject(new ApprovalAbortedError())
      }
    }
  }

  /** Reject every pending approval across every session. Used at shutdown. */
  clearAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new ApprovalAbortedError())
    }
    this.pending.clear()
  }

  private keyOf(sessionId: string, toolUseId: string): string {
    return `${sessionId}:${toolUseId}`
  }
}
