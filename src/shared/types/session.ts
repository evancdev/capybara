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
  gitBranch?: string
}
