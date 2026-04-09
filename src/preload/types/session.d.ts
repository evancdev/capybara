import type { PermissionMode, Session } from '@/shared/types/session'
import type {
  CreateSessionInput,
  RenameConversationInput
} from '@/shared/schemas/session'
import type {
  CapybaraMessage,
  ToolApprovalRequest,
  ToolApprovalResponse
} from '@/shared/types/messages'

/**
 * Result of a main-scope slash command. Most commands return nothing;
 * `/new` returns the id of the freshly created session so the renderer
 * can focus it.
 */
export interface RunCommandResult {
  newSessionId?: string
}

/**
 * Renderer-visible surface of the main process. Every method here is an IPC
 * trust boundary; keep the shape minimal and document each entry.
 */
export interface SessionAPI {
  /** Spawn a new agent session in the given working directory. */
  createSession(input: CreateSessionInput): Promise<Session>
  /** Tear down a session and release all resources associated with it. */
  destroySession(sessionId: string): Promise<void>
  /** Stop the agent mid-response. The session stays open so the user can send another message. */
  stopResponse(sessionId: string): Promise<void>
  /** Return information on every active session. */
  listSessions(): Promise<Session[]>
  /**
   * Subscribe to session exit events. Multiple subscribers are supported;
   * returns an unsubscribe function that removes this specific subscriber.
   */
  onSessionExited(
    callback: (sessionId: string, exitCode: number) => void
  ): () => void
  /** Open the native OS directory picker. Returns the path or null if cancelled. */
  selectDirectory(): Promise<string | null>
  /** List past Claude conversations for a project. */
  listConversations(projectPath: string): Promise<Session[]>
  /** Rename a stored conversation on disk. */
  renameConversation(input: RenameConversationInput): Promise<void>
  /** Send a user message into a running session. */
  sendMessage(sessionId: string, message: string): Promise<void>
  /** Return the full message history for a session. */
  getMessages(sessionId: string): Promise<CapybaraMessage[]>
  /** Respond to a pending tool-approval request from the main process. */
  respondToToolApproval(response: ToolApprovalResponse): Promise<void>
  /**
   * Subscribe to the one-shot user info payload sent at app startup.
   * Multiple subscribers are supported; returns an unsubscribe function.
   */
  onUserInfo(
    callback: (info: {
      username: string
      hostname: string
      homedir: string
    }) => void
  ): () => void
  /** Change the permission mode for a running session. */
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  /**
   * Dispatch a main-scope slash command (`/compact`, `/model`, `/new`).
   * Returns optional metadata — e.g. `newSessionId` for `/new`.
   */
  runCommand(
    sessionId: string,
    command: string,
    args: string[]
  ): Promise<RunCommandResult | undefined>
  /** Subscribe to streamed session messages. Returns an unsubscribe function. */
  onMessage(callback: (message: CapybaraMessage) => void): () => void
  /** Subscribe to tool-approval requests from the main process. Returns an unsubscribe function. */
  onToolApprovalRequest(
    callback: (request: ToolApprovalRequest) => void
  ): () => void
}
