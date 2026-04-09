import type { Session } from '@/shared/types/session'
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
  /** Subscribe to streamed session messages. Returns an unsubscribe function. */
  onMessage(callback: (message: CapybaraMessage) => void): () => void
  /** Subscribe to tool-approval requests from the main process. Returns an unsubscribe function. */
  onToolApprovalRequest(
    callback: (request: ToolApprovalRequest) => void
  ): () => void
}
