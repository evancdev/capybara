import type {
  SessionDescriptor,
  PromptInfo,
  Conversation
} from '@/shared/types/session'
import type { CreateSessionInput, ResizeInput } from '@/shared/schemas/session'

export interface SessionAPI {
  /** Spawn a new claude pty session in the given working directory. */
  createSession(input: CreateSessionInput): Promise<SessionDescriptor>
  /** Kill a pty session and remove it from the registry. */
  destroySession(sessionId: string): Promise<void>
  /** Set a custom display name. Empty string reverts to default. */
  renameSession(sessionId: string, name: string): Promise<SessionDescriptor>
  /** Return all active and exited sessions. */
  listSessions(): Promise<SessionDescriptor[]>
  /** Update pty dimensions when the terminal panel resizes. */
  resizeSession(input: ResizeInput): Promise<void>
  /** Send keystrokes to a session's pty. Fire-and-forget. */
  sendInput(sessionId: string, data: string): void
  /** Subscribe to pty output for all sessions. Replaces any existing listener. */
  onTerminalOutput(callback: (sessionId: string, data: string) => void): void
  /** Unsubscribe from pty output. */
  offTerminalOutput(): void
  /** Subscribe to session exit events. Replaces any existing listener. */
  onSessionExited(callback: (sessionId: string, exitCode: number) => void): void
  /** Unsubscribe from session exit events. */
  offSessionExited(): void
  /** Open the native OS directory picker. Returns path or null if cancelled. */
  selectDirectory(): Promise<string | null>
  /** Return buffered output for a session and clear the buffer. Used for tab switching. */
  replaySession(sessionId: string): Promise<string>
  /** Return full buffered output for a session without clearing. Used for history rebuild. */
  getSessionHistory(sessionId: string): Promise<string>
  /** Return username and hostname for rendering a synthetic shell prompt. */
  getPromptInfo(): Promise<PromptInfo>
  /** List Claude conversation history for a project directory. */
  listConversations(projectPath: string): Promise<Conversation[]>
}
