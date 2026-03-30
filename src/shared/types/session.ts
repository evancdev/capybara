export type SessionStatus = 'running' | 'exited'

export interface SessionDescriptor {
  id: string
  pid: number
  status: SessionStatus
  exitCode: number | null
  command: string
  cwd: string
  name: string
  createdAt: number
}

export interface PromptInfo {
  username: string
  hostname: string
}

export interface Conversation {
  id: string
  title: string
  lastActive: number
}
