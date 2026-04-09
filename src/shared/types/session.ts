export type SessionStatus = 'running' | 'exited'

export interface SessionMetadata {
  claudeCodeVersion?: string
  model?: string
  contextWindow?: string
  plan?: string
}

export interface Session {
  id: string
  status: SessionStatus
  exitCode: number | null
  createdAt: number
  metadata?: SessionMetadata
  title?: string
  lastActive?: number
  /** Declared agent role — populated by the `register_agent` MCP tool. */
  role: string | null
  /** Absolute path to the git worktree root for the session cwd, or null if cwd is not a git repo. Snapshot at session create. */
  gitRoot: string | null
  /** Current branch at session create time, or null if detached/not-a-repo. */
  gitBranch: string | null
}

/**
 * Directory entry returned by the `list_agents` MCP tool. Safe to serialize;
 * contains only public identity + location info — no handles, no history.
 */
export interface AgentDirectoryEntry {
  id: string
  role: string | null
  name: string | null
  cwd: string
  gitRoot: string | null
  gitBranch: string | null
  status: SessionStatus
  createdAt: number
}
