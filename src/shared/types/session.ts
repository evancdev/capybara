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
  gitBranch?: string
}
