import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import {
  MAX_GLOBAL_SESSIONS,
  TOOL_APPROVAL_TIMEOUT_MS
} from '@/main/types/constants'
import type {
  Session,
  SessionStatus,
  SessionMetadata
} from '@/shared/types/session'
import type {
  CapybaraMessage,
  SessionUsageSummary,
  ToolApprovalRequest
} from '@/shared/types/messages'
import type {
  ClaudeConnection,
  ConnectionContext,
  PermissionResult
} from '@/main/claude/connection'
import type {
  listConversations as listClaudeConversations,
  loadConversationMessages,
  renameConversation as renameClaudeConversation
} from '@/main/claude/history'
import { SessionNotFoundError, SessionLimitError } from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'
import {
  isToolAutoApproved,
  evaluateToolPolicy
} from '@/main/services/tools'
import { MessageHistoryStore } from '@/main/services/message-history'
import { ToolApprovalBroker } from '@/main/services/tool-approval-broker'

/** Warn when active sessions reach 80% of the global cap. */
const SESSION_CAP_WARN_THRESHOLD = Math.floor(MAX_GLOBAL_SESSIONS * 0.8)

/**
 * Factory signature for ClaudeConnection. Injected so tests can substitute
 * a fake implementation without module mocking gymnastics.
 */
export type ConnectionFactory = (ctx: ConnectionContext) => ClaudeConnection

/**
 * History/conversation helper surface. Injected so tests don't have to mock
 * the SDK module globally.
 */
export interface ConversationHistoryDeps {
  listConversations: typeof listClaudeConversations
  loadConversationMessages: typeof loadConversationMessages
  renameConversation: typeof renameClaudeConversation
}

/** Dependencies composed at the application root. */
export interface SessionServiceDeps {
  connectionFactory: ConnectionFactory
  conversations: ConversationHistoryDeps
  history?: MessageHistoryStore
  approvals?: ToolApprovalBroker
}

/**
 * File-local registry entry. This extends the serializable Session
 * descriptor with backend-only fields (connection handle, mutable metadata,
 * cwd). Never crosses the IPC boundary — only the Session projection does.
 */
interface InternalSession extends Session {
  cwd: string
  connection: ClaudeConnection
  liveMetadata: SessionMetadata
}

/**
 * Typed event map for SessionService. Keep in sync with every `emit()` call.
 */
export interface SessionServiceEvents {
  message: [sessionId: string, message: CapybaraMessage]
  exited: [sessionId: string, exitCode: number]
  'tool-approval': [request: ToolApprovalRequest]
}

/**
 * Manages live Claude sessions: spawn, route messages, shut down, resume.
 *
 * Composes three collaborators:
 *  - MessageHistoryStore — per-session message buffer
 *  - ToolApprovalBroker  — pending tool-approval registry with timeouts
 *  - ConnectionFactory   — constructs a ClaudeConnection per session
 *
 * SessionService itself owns the session registry (id → InternalSession),
 * the EventEmitter surface the IPC layer subscribes to, and the lifecycle
 * glue (create / destroy / shutdown / session-exit bookkeeping).
 */
export class SessionService extends EventEmitter<SessionServiceEvents> {
  private sessions = new Map<string, InternalSession>()
  private destroying = false
  private readonly history: MessageHistoryStore
  private readonly approvals: ToolApprovalBroker
  private readonly createConnection: ConnectionFactory
  private readonly conversations: ConversationHistoryDeps

  constructor(deps: SessionServiceDeps) {
    super()
    this.history = deps.history ?? new MessageHistoryStore()
    this.approvals =
      deps.approvals ??
      new ToolApprovalBroker(TOOL_APPROVAL_TIMEOUT_MS, (req) =>
        this.emit('tool-approval', req)
      )
    this.createConnection = deps.connectionFactory
    this.conversations = deps.conversations
  }

  /** Creates a new session, optionally resuming a prior conversation. */
  async create(cwd: string, resumeId?: string): Promise<Session> {
    this.destroying = false

    // Only non-exited sessions count against the global cap. Exited sessions
    // stick around so the renderer can still read their history until the
    // user explicitly destroys them; they should not block new creates.
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) => s.status !== 'exited'
    )
    if (activeSessions.length >= MAX_GLOBAL_SESSIONS) {
      throw new SessionLimitError(
        `Maximum of ${MAX_GLOBAL_SESSIONS} active sessions reached. Destroy existing sessions before creating new ones.`
      )
    }

    const sessionsForCwd = activeSessions.filter(
      (s) => s.cwd === cwd && s.status === 'running'
    )
    if (sessionsForCwd.length >= MAX_AGENTS_PER_PROJECT) {
      throw new SessionLimitError(
        `Maximum of ${MAX_AGENTS_PER_PROJECT} active sessions per project directory reached`
      )
    }

    const id = randomUUID()

    const usageSummary: SessionUsageSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: null,
      turnCount: 0
    }
    // liveMetadata starts empty; the translator populates fields
    // (claudeCodeVersion, model, contextWindow) when the SDK init message lands.
    const liveMetadata: SessionMetadata = {}
    // conversationId lives here, closed over by the LiveSessionState below.
    // It is not on InternalSession because only the translator writes it.
    let conversationId: string | null = resumeId ?? null

    if (resumeId !== undefined) {
      const initial = await this.conversations.loadConversationMessages(
        cwd,
        resumeId,
        id
      )
      this.history.init(id, initial)
      logger.info('Loaded conversation history for resume', {
        sessionId: id,
        conversationId: resumeId,
        messageCount: initial.length
      })
    } else {
      this.history.init(id)
    }

    const ctx: ConnectionContext = {
      cwd,
      sessionId: id,
      resumeId,
      state: {
        usageSummary,
        liveMetadata,
        setConversationId: (next: string) => {
          if (conversationId === next) return
          conversationId = next
          logger.info('Captured conversation ID', {
            sessionId: id,
            conversationId: next
          })
        },
        getConversationId: () => conversationId
      },
      isToolAutoApproved,
      evaluateToolPolicy,
      onToolApprovalRequest: (req) => this.approvals.request(req)
    }

    const connection = this.createConnection(ctx)
    const session: InternalSession = {
      id,
      status: 'running' as SessionStatus,
      exitCode: null,
      cwd,
      createdAt: Date.now(),
      liveMetadata,
      connection
    }
    this.sessions.set(id, session)

    // Active count after insert. Warn at the threshold so we catch leaks
    // before hitting the hard cap in production.
    const activeCount = activeSessions.length + 1
    if (activeCount >= SESSION_CAP_WARN_THRESHOLD) {
      logger.warn('Active session count nearing cap', {
        active: activeCount,
        cap: MAX_GLOBAL_SESSIONS,
        threshold: SESSION_CAP_WARN_THRESHOLD
      })
    }

    this.consumeConnection(session).catch((err: unknown) => {
      logger.error('Claude loop failed', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err)
      })
      this.handleSessionExit(id, 1)
    })

    return this.toSession(session)
  }

  /** Destroys a session and cleans up all associated state. */
  destroy(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return

    this.closeConnection(session)
    this.sessions.delete(id)
    this.history.delete(id)
    this.approvals.clearForSession(id)
  }

  /** Destroys all sessions. Used during app shutdown. */
  destroyAll(): void {
    this.destroying = true
    for (const session of this.sessions.values()) {
      this.closeConnection(session)
    }
    this.sessions.clear()
    this.history.clear()
    this.approvals.clearAll()
  }

  /** Returns descriptors for all active sessions. */
  list(): Session[] {
    return Array.from(this.sessions.values()).map((s) => this.toSession(s))
  }

  /** Stops the agent mid-response. The session stays open for more messages. */
  stopResponse(id: string): void {
    const session = this.getSession(id)
    logger.info('Stop response requested', {
      sessionId: id,
      currentStatus: session.status
    })
    session.connection.abort()
  }

  /** Pushes a user message into the active connection. */
  write(id: string, message: string): void {
    const session = this.getSession(id)
    if (session.status !== 'running') {
      logger.warn('Cannot write to non-running session', { sessionId: id })
      return
    }
    session.connection.send(message)
  }

  /** Returns the message history for a session. */
  getMessages(id: string): CapybaraMessage[] {
    this.getSession(id)
    return this.history.get(id)
  }

  /** Resolves a pending tool approval from the renderer's IPC response. */
  handleToolApprovalResponse(
    sessionId: string,
    toolUseId: string,
    decision: 'approve' | 'deny',
    message: string | null
  ): void {
    this.approvals.respond(sessionId, toolUseId, decision, message)
  }

  /** Lists past Claude conversations for a project. */
  async listConversations(projectPath: string): Promise<Session[]> {
    return this.conversations.listConversations(projectPath)
  }

  /** Renames a stored Claude conversation. */
  async renameConversation(
    conversationId: string,
    title: string,
    cwd?: string
  ): Promise<void> {
    return this.conversations.renameConversation(conversationId, title, cwd)
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Fires close() on a connection and logs any synchronous failure. */
  private closeConnection(session: InternalSession): void {
    try {
      session.connection.close()
    } catch (err: unknown) {
      logger.error('Claude connection close failed', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  /** Iterates the connection's event stream and emits each message. */
  private async consumeConnection(session: InternalSession): Promise<void> {
    try {
      for await (const msg of session.connection.start()) {
        this.emitMessage(session.id, msg)
      }
    } finally {
      if (!this.destroying && this.sessions.has(session.id)) {
        this.handleSessionExit(session.id, 0)
      }
    }
  }

  /**
   * Stores a message in history and emits it to subscribers.
   *
   * Race guard: if the session was destroyed while the SDK was yielding, we
   * must not persist to history or forward the event to the renderer. The
   * for-await loop in consumeConnection also checks these conditions, but
   * there is a one-tick gap between the async iterator yielding and the loop
   * body running, so we re-check here for safety.
   */
  private emitMessage(sessionId: string, message: CapybaraMessage): void {
    if (this.destroying || !this.sessions.has(sessionId)) return

    this.history.append(sessionId, message)
    this.emit('message', sessionId, message)
  }

  private handleSessionExit(sessionId: string, exitCode: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Idempotent: consumeConnection's finally and the consumeConnection()
    // .catch in create() can both race to call this on errors. First call wins.
    if (session.status === 'exited') return

    logger.info('Session exiting', {
      sessionId,
      previousStatus: session.status,
      exitCode
    })

    session.status = 'exited' as SessionStatus
    session.exitCode = exitCode
    this.approvals.clearForSession(sessionId)
    this.emit('exited', sessionId, exitCode)
  }

  private getSession(id: string): InternalSession {
    const session = this.sessions.get(id)
    if (!session) {
      throw new SessionNotFoundError(id)
    }
    return session
  }

  private toSession(session: InternalSession): Session {
    return {
      id: session.id,
      status: session.status,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      metadata: { ...session.liveMetadata }
    }
  }

  /**
   * Expose a bound helper so outside callers (the composition root) can wire
   * `PermissionResult` promises without poking at broker internals. Kept
   * here for backward compatibility with any consumers that used to grab
   * `requestToolApproval` off the service itself.
   */
  requestToolApproval(
    req: ToolApprovalRequest
  ): Promise<PermissionResult> {
    return this.approvals.request(req)
  }
}
