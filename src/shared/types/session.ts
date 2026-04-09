export type SessionStatus = 'running' | 'exited'

/**
 * Permission modes mirror the Claude Agent SDK's `Options.permissionMode`
 * union verbatim. The SDK enforces Plan/Auto semantics at the model layer;
 * we just pass the selection through.
 */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default'

/**
 * Order used by Shift+Tab mode cycling. Only the three user-facing modes
 * rotate; `bypassPermissions` and `dontAsk` are reachable via `/mode` but
 * not via the cycle keybinding.
 */
export const CYCLING_PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'plan',
  'acceptEdits'
] as const

export type PermissionModeLabel =
  | 'approve'
  | 'plan'
  | 'auto'
  | 'bypass'
  | 'dontask'

export function permissionModeLabel(mode: PermissionMode): PermissionModeLabel {
  switch (mode) {
    case 'default':
      return 'approve'
    case 'plan':
      return 'plan'
    case 'acceptEdits':
      return 'auto'
    case 'bypassPermissions':
      return 'bypass'
    case 'dontAsk':
      return 'dontask'
  }
}

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
  permissionMode: PermissionMode
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
  /** Git-ref-style display name: "role/branch#hash", computed from role + gitBranch + sessionId. */
  displayName: string

  name: string | null
  cwd: string
  gitRoot: string | null
  gitBranch: string | null
  status: SessionStatus
  createdAt: number
}
