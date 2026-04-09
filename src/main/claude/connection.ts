import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  McpSdkServerConfigWithInstance,
  Options,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  CapybaraMessage,
  SessionUsageSummary,
  ToolApprovalRequest
} from '@/shared/types/messages'
import type { SessionMetadata } from '@/shared/types/session'
import type { ToolApprovalResult } from '@/main/types/tools'
import { translateSdkMessage } from '@/main/claude/translator'
import { getCleanChildEnv } from '@/main/lib/electron-env'
import { logger } from '@/main/lib/logger'

/** Approval result handed back to the SDK's `canUseTool` callback. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** Mutable state the translator updates as SDK events arrive. */
export interface LiveSessionState {
  usageSummary: SessionUsageSummary
  liveMetadata: SessionMetadata
  setConversationId(id: string): void
  getConversationId(): string | null
}

/** Dependencies handed in when SessionService constructs a connection. */
export interface ConnectionContext {
  cwd: string
  sessionId: string
  resumeId?: string
  state: LiveSessionState
  isToolAutoApproved: (toolName: string) => boolean
  evaluateToolPolicy: (
    toolName: string,
    input: Record<string, unknown>
  ) => ToolApprovalResult
  onToolApprovalRequest: (
    req: ToolApprovalRequest
  ) => Promise<PermissionResult>
  /**
   * Optional in-process MCP servers to register with the SDK query. Keyed by
   * server name. Used for inter-agent tooling.
   */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>
}

/**
 * One live Claude session. Runs the SDK query, forwards user messages into
 * it, streams translated messages out, and restarts the query when the user
 * stops the agent mid-response.
 */
export class ClaudeConnection {
  private readonly ctx: ConnectionContext
  private userMessageQueue: SDKUserMessage[] = []
  private userMessageResolver: ((msg: SDKUserMessage) => void) | null = null
  private userMessageRejector: ((err: Error) => void) | null = null
  private abortController = new AbortController()
  private aborting = false
  private closed = false

  constructor(ctx: ConnectionContext) {
    this.ctx = ctx
  }

  /**
   * Drive the SDK loop and yield CapybaraMessages. On user-initiated abort,
   * restart the loop with a fresh controller and the latest conversation ID.
   * On close, exit cleanly.
   */
  async *start(): AsyncIterable<CapybaraMessage> {
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- this.closed is mutated by close() while the loop awaits */
    while (!this.closed) {
      const resumeId = this.ctx.state.getConversationId() ?? undefined
      try {
        yield* this.runOnce(resumeId)
      } catch (err: unknown) {
        if (this.closed) return
        if (err instanceof Error && err.name === 'AbortError') {
          logger.info('SDK session aborted', { sessionId: this.ctx.sessionId })
        } else {
          const errorMessage =
            err instanceof Error ? err.message : String(err)
          logger.error('SDK session error', {
            sessionId: this.ctx.sessionId,
            error: errorMessage
          })
          yield {
            kind: 'error_message',
            sessionId: this.ctx.sessionId,
            code: 'unknown',
            message: errorMessage,
            recoverable: false
          }
        }
      }

      // Restart logic: if this was a user-initiated abort and we're not closed,
      // start a fresh loop with the latest conversation ID. Otherwise we're done.
      if (this.aborting && !this.closed) {
        this.aborting = false
        this.abortController = new AbortController()
        logger.info('Restarting Claude loop after abort', {
          sessionId: this.ctx.sessionId,
          resumeConversationId: this.ctx.state.getConversationId() ?? null
        })
        continue
      }

      return
    }
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  }

  send(text: string): void {
    if (this.closed) {
      logger.warn('Cannot send to closed Claude connection', {
        sessionId: this.ctx.sessionId
      })
      return
    }
    this.pushUserMessage({
      type: 'user',
      session_id: this.ctx.sessionId,
      message: { role: 'user', content: text },
      parent_tool_use_id: null
    })
  }

  abort(): void {
    logger.info('Claude connection abort requested', {
      sessionId: this.ctx.sessionId
    })

    this.aborting = true
    this.rejectPendingPush(new Error('Session aborted'))

    try {
      this.abortController.abort()
    } catch (err) {
      logger.warn('Failed to abort Claude SDK query', {
        sessionId: this.ctx.sessionId,
        error: err
      })
    }
  }

  /**
   * Tear down the connection. Synchronous: aborts the SDK query, rejects any
   * pending user-message push, and drops queued but unsent user messages so
   * the instance holds no further references once it returns.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.aborting = false
    this.rejectPendingPush(new Error('Session closed'))
    this.userMessageQueue = []

    try {
      this.abortController.abort()
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------
  // User message queue (push→pull bridge for the SDK's prompt stream)
  // ---------------------------------------------------------------------------

  /** Push a message into the queue. Resolves the pending await if any. */
  private pushUserMessage(msg: SDKUserMessage): void {
    if (this.userMessageResolver !== null) {
      const resolver = this.userMessageResolver
      this.userMessageResolver = null
      this.userMessageRejector = null
      resolver(msg)
    } else {
      this.userMessageQueue.push(msg)
    }
  }

  /** Rejects the pending await if any (no-op if nothing is waiting). */
  private rejectPendingPush(err: Error): void {
    if (this.userMessageRejector !== null) {
      const rejector = this.userMessageRejector
      this.userMessageResolver = null
      this.userMessageRejector = null
      rejector(err)
    }
  }

  /** Yields the next user message, awaiting one if the queue is empty. */
  private async nextUserMessage(): Promise<SDKUserMessage> {
    const buffered = this.userMessageQueue.shift()
    if (buffered !== undefined) return buffered
    return new Promise<SDKUserMessage>((resolve, reject) => {
      this.userMessageResolver = resolve
      this.userMessageRejector = reject
    })
  }

  /** Generator the SDK consumes for user messages. */
  private async *createUserMessageGenerator(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      let msg: SDKUserMessage
      try {
        msg = await this.nextUserMessage()
      } catch {
        // Pending push was rejected (session aborted/closed). Exit cleanly.
        return
      }
      yield msg
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: a single SDK query iteration
  // ---------------------------------------------------------------------------

  /** One SDK query pass. Yields translated messages; throws on SDK error. */
  private async *runOnce(
    resumeId: string | undefined
  ): AsyncGenerator<CapybaraMessage> {
    const messageStream = this.createUserMessageGenerator()

    const options: Options = {
      cwd: this.ctx.cwd,
      includePartialMessages: true,
      abortController: this.abortController,
      env: getCleanChildEnv(),
      canUseTool: async (toolName, input, context) => {
        const policy = this.ctx.evaluateToolPolicy(toolName, input)

        if (policy.behavior === 'allow') {
          return { behavior: 'allow' }
        }

        try {
          return await this.ctx.onToolApprovalRequest({
            sessionId: this.ctx.sessionId,
            toolUseId: context.toolUseID,
            toolName,
            input,
            title: context.title,
            description: context.description,
            reason: context.decisionReason
          })
        } catch (err) {
          // Approval was aborted (session closed or aborted mid-approval).
          // Return a clean deny so the SDK can tear down without leaking.
          logger.info('Tool approval aborted, denying', {
            toolName,
            toolUseId: context.toolUseID,
            sessionId: this.ctx.sessionId,
            error: err instanceof Error ? err.message : String(err)
          })
          return { behavior: 'deny', message: 'Aborted' }
        }
      }
    }

    if (resumeId !== undefined) {
      options.resume = resumeId
    }

    if (this.ctx.mcpServers !== undefined) {
      options.mcpServers = this.ctx.mcpServers
    }

    logger.info('Starting Claude SDK query', {
      sessionId: this.ctx.sessionId,
      cwd: this.ctx.cwd,
      resume: resumeId ?? null
    })

    const queryStream = query({
      prompt: messageStream,
      options
    })

    // Capture the controller for THIS iteration. abort() replaces the field.
    const loopController = this.abortController

    for await (const sdkMessage of queryStream) {
      if (this.closed) return
      if (loopController.signal.aborted) return

      const messages = translateSdkMessage(
        sdkMessage,
        this.ctx.sessionId,
        this.ctx.state,
        { isToolAutoApproved: this.ctx.isToolAutoApproved }
      )
      for (const msg of messages) {
        yield msg
      }
    }
  }
}
