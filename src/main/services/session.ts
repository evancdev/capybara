import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import type {
  CapybaraMessage,
  InterAgentMessage,
  SessionUsageSummary,
  ToolApprovalRequest
} from '@/shared/types/messages'
import type {
  AgentDirectoryEntry,
  Session,
  SessionStatus,
  SessionMetadata,
  PermissionMode
} from '@/shared/types/session'
import { DEFAULT_EFFORT_LEVEL, DEFAULT_PERMISSION_MODE } from '@/shared/types/session'
import type { EffortLevel } from '@/shared/types/session'
import type { MainSlashCommandRegistry } from '@/main/services/slash-commands'
import { UnknownSlashCommandError } from '@/main/lib/errors'

import {
  buildInterAgentMcpServer,
  INTER_AGENT_MCP_SERVER_NAME
} from '@/main/mcp'
import type { InterAgentDirectory } from '@/main/mcp'
import { buildRegisterAgentHook } from '@/main/hooks/register-agent-hook'
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
import {
  SessionNotFoundError,
  SessionLimitError,
  TargetSessionExitedError
} from '@/main/lib/errors'
import { loadAgentIdentity, saveAgentIdentity } from '@/main/lib/agent-identities'
import { logger } from '@/main/lib/logger'
import {
  isToolAutoApproved,
  evaluateToolPolicy
} from '@/main/services/tools'
import { MessageHistoryStore } from '@/main/services/message-history'
import { ToolApprovalBroker } from '@/main/services/tool-approval-broker'
import type { InterAgentRouter } from '@/main/services/inter-agent-router'
import {
  MAX_GLOBAL_SESSIONS,
  TOOL_APPROVAL_TIMEOUT_MS
} from '@/main/types/constants'

const execFileAsync = promisify(execFile)

/** Max length for a registered agent role (matches zod schema in MCP tool). */
const MAX_ROLE_LENGTH = 64

/**
 * Run a single git command in `cwd` and return stdout trimmed, or null on
 * any failure (non-repo, git missing, timeout, non-zero exit). Never throws
 * — callers use null to mean "unknown / not applicable". 2s timeout so a
 * hung git subprocess cannot block session create.
 */
async function safeGit(
  cwd: string,
  args: readonly string[]
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args as string[], {
      cwd,
      timeout: 2_000,
      windowsHide: true
    })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/** Snapshot the git worktree root + branch for `cwd`. Both null on failure. */
async function snapshotGitInfo(
  cwd: string
): Promise<{ gitRoot: string | null; gitBranch: string | null }> {
  const [gitRoot, gitBranch] = await Promise.all([
    safeGit(cwd, ['rev-parse', '--show-toplevel']),
    safeGit(cwd, ['branch', '--show-current'])
  ])
  return { gitRoot, gitBranch }
}
/**
 * Compute a git-ref-style display name from the session's role, branch, and id.
 * Always returns a non-empty string — no persistence or pool required.
 *
 *   role + branch → "backend-engineer/feature-auth#a3f8"
 *   role only     → "backend-engineer#a3f8"
 *   neither       → "agent#a3f8"
 */
function computeDisplayName(
  role: string | null,
  gitBranch: string | null,
  sessionId: string
): string {
  const hash = sessionId.slice(0, 4)
  // Sanitize `/` in role so the "role/branch" separator stays unambiguous.
  // Only the display name is affected — the stored role is untouched.
  const safeRole = role !== null ? role.replace(/\//g, '-') : null
  if (safeRole !== null && gitBranch !== null) return `${safeRole}/${gitBranch}#${hash}`
  if (safeRole !== null) return `${safeRole}#${hash}`
  return `agent#${hash}`
}

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
  /**
   * Main-dispatched slash command registry. Injected so the service does
   * not statically depend on the `slash-commands` module (composition root
   * wires it in `src/main/index.ts`).
   */
  mainCommands?: MainSlashCommandRegistry
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
  permissionMode: PermissionMode
  effortLevel: EffortLevel
  /**
   * Git worktree root for `cwd` at session-create time. Captured once
   * (we do NOT re-run git on every directory query) so `list_agents` stays
   * cheap and deterministic even as the working tree moves underneath us.
   */
  gitRoot: string | null
  /** Git branch at session-create time. See gitRoot for caching rationale. */
  gitBranch: string | null
  /** Declared role from `register_agent`; null until the agent registers. */
  role: string | null
  /** Returns the conversation ID if known, or null. */
  getConversationId: () => string | null
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
  private readonly mainCommands: MainSlashCommandRegistry
  private interAgentRouter: InterAgentRouter | null = null

  constructor(deps: SessionServiceDeps) {
    super()
    // Deep inter-agent chains attach many short-lived `message`/`exited`
    // listeners via InterAgentRouter.waitForReply. Each listener self-detaches
    // on settle, but the default 10-listener ceiling would emit false-positive
    // warnings under load. Disable the cap — leaks are caught by
    // waitForReply's finish() cleanup, not by this counter.
    this.setMaxListeners(0)
    this.history = deps.history ?? new MessageHistoryStore()
    this.approvals =
      deps.approvals ??
      new ToolApprovalBroker(TOOL_APPROVAL_TIMEOUT_MS, (req) =>
        this.emit('tool-approval', req)
      )
    this.createConnection = deps.connectionFactory
    this.conversations = deps.conversations
    this.mainCommands = deps.mainCommands ?? {}
  }

  /**
   * Wire the inter-agent router. Called once at the composition root after
   * both SessionService and InterAgentRouter are constructed (they have a
   * mutual dependency that is broken by this setter).
   */
  setInterAgentRouter(router: InterAgentRouter): void {
    this.interAgentRouter = router
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

    const storedRole = resumeId !== undefined ? loadAgentIdentity(resumeId) : null

    if (this.interAgentRouter === null) {
      throw new Error(
        'InterAgentRouter must be set on SessionService before creating sessions'
      )
    }
    const router = this.interAgentRouter

    // Snapshot git info for the session cwd. Runs in parallel with connection
    // construction below via await here, then the value is cached on
    // InternalSession for the life of the session. Failure (non-repo, missing
    // git) degrades gracefully to null — we never block session creation.
    const { gitRoot, gitBranch } = await snapshotGitInfo(cwd)

    // SessionService implements InterAgentDirectory; pass a narrow view of it
    // (not `this`) so the MCP layer cannot touch connections, history, or
    // other internals. `this` is cast to the interface via method references.
    const directory: InterAgentDirectory = {
      registerRole: (sessionId, role) => this.registerRole(sessionId, role),
      getAgentDirectory: () => this.getAgentDirectory()
    }

    const ctx: ConnectionContext = {
      cwd,
      sessionId: id,
      resumeId,
      state: {
        usageSummary,
        liveMetadata,
        permissionMode: DEFAULT_PERMISSION_MODE,
        effortLevel: DEFAULT_EFFORT_LEVEL,
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
      onToolApprovalRequest: (req) => this.approvals.request(req),
      mcpServers: {
        [INTER_AGENT_MCP_SERVER_NAME]: buildInterAgentMcpServer(
          id,
          router,
          directory
        )
      },
      hooks: buildRegisterAgentHook(id)
    }

    const connection = this.createConnection(ctx)
    const session: InternalSession = {
      id,
      status: 'running' as SessionStatus,
      exitCode: null,
      cwd,
      createdAt: Date.now(),
      permissionMode: DEFAULT_PERMISSION_MODE,
      effortLevel: DEFAULT_EFFORT_LEVEL,
      liveMetadata,
      connection,
      gitRoot,
      gitBranch,
      role: storedRole,
      getConversationId: () => conversationId
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

    this.handleSessionExit(id, 1)
    this.closeConnection(session)
    this.sessions.delete(id)
    this.history.delete(id)
    this.approvals.clearForSession(id)
  }

  /** Destroys all sessions. Used during app shutdown. */
  destroyAll(): void {
    this.destroying = true
    for (const session of this.sessions.values()) {
      // Emit 'exited' so inter-agent waiters targeting this session unblock
      // instead of hanging until timeout. handleSessionExit is idempotent.
      if (session.status !== 'exited') {
        this.handleSessionExit(session.id, 1)
      }
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

  /**
   * Update the permission mode for a session. Drives the live SDK query if
   * one is active, updates the persisted descriptor, and fans out a
   * `metadata_updated` event so the renderer reflects the change.
   */
  setPermissionMode(id: string, mode: PermissionMode): void {
    const session = this.getSession(id)
    session.connection.setPermissionMode(mode)
    session.permissionMode = mode
    this.emitMessage(id, {
      kind: 'metadata_updated',
      sessionId: id,
      metadata: {
        ...session.liveMetadata,
        permissionMode: mode,
        effortLevel: session.effortLevel
      }
    })
  }

  /**
   * Fan out a `metadata_updated` event for the given session. Intended for
   * slash-command handlers that mutate `LiveSessionState.liveMetadata`
   * (e.g. `/model`) and need the renderer to reflect the change.
   */
  notifyMetadataUpdated(id: string): void {
    const session = this.getSession(id)
    this.emitMessage(id, {
      kind: 'metadata_updated',
      sessionId: id,
      metadata: {
        ...session.liveMetadata,
        effortLevel: session.effortLevel
      }
    })
  }

  /**
   * Dispatch a main-scoped slash command. Returns a result object so
   * handlers that need to surface new state can do so without a second
   * round trip. Today no kept handler populates the result, but the shape
   * is preserved for future commands.
   */
  async runCommand(
    id: string,
    command: string,
    args: string[]
  ): Promise<{ newSessionId?: string }> {
    const key = command.toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(this.mainCommands, key)) {
      throw new UnknownSlashCommandError(command)
    }
    const entry = this.mainCommands[key]
    const session = this.getSession(id)
    return entry.handler({
      sessionId: id,
      cwd: session.cwd,
      args,
      sessionService: this,
      connection: session.connection
    })
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

  /**
   * Deliver an inter-agent message into `targetId`'s conversation. Emits a
   * provenance `InterAgentMessage` bubble to the target's timeline AND pushes
   * a prefixed user turn into the target's SDK connection so the target's
   * model sees the message as a normal user prompt.
   *
   * Called by `InterAgentRouter.handleToolCall` after cycle/depth checks.
   * Not exposed over IPC — only the router invokes this.
   *
   * Throws `SessionNotFoundError` if the target id is unknown, or
   * `TargetSessionExitedError` if the target has already exited.
   */
  deliverInterAgentMessage(
    targetId: string,
    fromId: string,
    content: string
  ): void {
    const target = this.getSession(targetId)
    if (target.status !== 'running') {
      throw new TargetSessionExitedError(targetId)
    }

    const sender = this.sessions.get(fromId)
    const senderDisplayName = computeDisplayName(
      sender?.role ?? null,
      sender?.gitBranch ?? null,
      fromId
    )

    const bubble: InterAgentMessage = {
      kind: 'inter_agent_message',
      sessionId: targetId,
      fromSessionId: fromId,
      fromDisplayName: senderDisplayName,
      content,
      timestamp: Date.now()
    }
    this.emitMessage(targetId, bubble)
    target.connection.send(`[${senderDisplayName}]: ${content}`)
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
      permissionMode: session.permissionMode,
      effortLevel: session.effortLevel,
      metadata: { ...session.liveMetadata },
      role: session.role,
      gitRoot: session.gitRoot,
      gitBranch: session.gitBranch
    }
  }

  /**
   * Record a role for `sessionId`. Idempotent — overwrites any prior role.
   * Validates the role string: trimmed, 1..MAX_ROLE_LENGTH chars. Throws
   * `SessionNotFoundError` if the id is unknown. Input validation errors
   * are thrown as plain Error so the MCP handler surfaces them as tool
   * errors to the model.
   */
  registerRole(
    sessionId: string,
    role: string
  ): {
    ok: true
    role: string
    displayName: string
    previousRole: string | null
  } {
    const trimmed = role.trim()
    if (trimmed.length === 0) {
      throw new Error('role must be a non-empty string')
    }
    if (trimmed.length > MAX_ROLE_LENGTH) {
      throw new Error(
        `role must be ${String(MAX_ROLE_LENGTH)} characters or fewer`
      )
    }

    const session = this.getSession(sessionId)
    const previousRole = session.role
    session.role = trimmed

    const convId = session.getConversationId()
    if (convId !== null) {
      saveAgentIdentity(convId, trimmed)
    }

    const displayName = computeDisplayName(trimmed, session.gitBranch, sessionId)

    this.emitMessage(sessionId, {
      kind: 'metadata_updated',
      sessionId,
      metadata: { role: trimmed }
    })

    logger.info('Agent role registered', {
      sessionId,
      role: trimmed,
      displayName,
      previousRole
    })

    return {
      ok: true,
      role: trimmed,
      displayName,
      previousRole
    }
  }

  /**
   * Snapshot all live sessions into serializable directory entries. Pure
   * synchronous projection over the session registry — no filtering, no
   * git calls, no history access. Used by the `list_agents` MCP tool.
   * Includes the caller's own session; self-exclusion would surprise models
   * that just want a full roster.
   */
  getAgentDirectory(): AgentDirectoryEntry[] {
    const entries: AgentDirectoryEntry[] = []
    for (const session of this.sessions.values()) {
      entries.push({
        id: session.id,
        role: session.role,
        displayName: computeDisplayName(session.role, session.gitBranch, session.id),
        // No main-side session-names store exists yet; always null until
        // a future task introduces one.
        name: null,
        cwd: session.cwd,
        gitRoot: session.gitRoot,
        gitBranch: session.gitBranch,
        status: session.status,
        createdAt: session.createdAt
      })
    }
    return entries
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
