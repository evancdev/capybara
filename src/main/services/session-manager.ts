import * as pty from 'node-pty'
import { randomUUID } from 'crypto'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import { MAX_BUFFER_SIZE, MAX_GLOBAL_SESSIONS } from '@/main/types/constants'
import type { SessionDescriptor } from '@/shared/types/session'
import type { CreateSessionInput } from '@/shared/schemas/session'
import type { InternalSession } from '@/main/types/session'
import { SessionNotFoundError } from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'

export class SessionManager {
  private sessions = new Map<string, InternalSession>()
  private nextSessionNumber = 1
  private destroying = false

  create(
    input: CreateSessionInput,
    onData: (id: string, data: string) => void,
    onExit: (id: string, exitCode: number) => void
  ): SessionDescriptor {
    this.destroying = false

    if (this.sessions.size >= MAX_GLOBAL_SESSIONS) {
      throw new Error(
        `Maximum of ${MAX_GLOBAL_SESSIONS} total sessions reached. Destroy existing sessions before creating new ones.`
      )
    }

    const cwd = input.cwd
    const resumeId = input.resumeConversationId
    const command =
      resumeId !== undefined ? `claude --resume ${resumeId}` : 'claude'
    const defaultName = `Agent ${this.nextSessionNumber++}`
    const name = input.name ?? defaultName

    const sessionsForCwd = Array.from(this.sessions.values()).filter(
      (s) => s.cwd === cwd && s.status === 'running'
    )
    if (sessionsForCwd.length >= MAX_AGENTS_PER_PROJECT) {
      throw new Error(
        `Maximum of ${MAX_AGENTS_PER_PROJECT} active sessions per project directory reached`
      )
    }

    const id = randomUUID()

    // Login shell (-l) sources profile files so PATH includes `claude`.
    // `exec` replaces the shell so signals go directly to the command.
    // SECURITY: resumeId is passed as $1 (positional arg), not interpolated,
    // to prevent shell injection if the UUID schema is ever relaxed.
    let file: string
    let args: string[]

    if (process.platform === 'win32') {
      file = 'powershell.exe'
      args =
        resumeId !== undefined
          ? ['-Command', 'claude', '--resume', resumeId]
          : ['-Command', 'claude']
    } else {
      const shellEnv = process.env.SHELL
      const shell =
        shellEnv !== undefined && shellEnv !== '' ? shellEnv : '/bin/bash'
      file = shell
      args =
        resumeId !== undefined
          ? ['-l', '-c', 'exec claude --resume "$1"', '--', resumeId]
          : ['-l', '-c', 'exec claude']
    }

    // Strip Electron env vars that would break child process behavior.
    const cleanEnv = { ...process.env } as Record<string, string>
    delete cleanEnv.ELECTRON_RUN_AS_NODE
    delete cleanEnv.ELECTRON_NO_ASAR
    delete cleanEnv.ELECTRON_NO_ATTACH_CONSOLE

    const ptyProcess = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: cleanEnv
    })

    const session: InternalSession = {
      id,
      pty: ptyProcess,
      pid: ptyProcess.pid,
      status: 'running',
      exitCode: null,
      command,
      cwd,
      name,
      defaultName,
      createdAt: Date.now(),
      buffer: [],
      bufferSize: 0
    }

    this.sessions.set(id, session)

    ptyProcess.onData((data: string) => {
      if (this.destroying) return
      session.buffer.push(data)
      session.bufferSize += data.length
      if (session.bufferSize > MAX_BUFFER_SIZE && session.buffer.length > 1) {
        let removeSize = 0
        let cutIndex = 0
        while (
          cutIndex < session.buffer.length - 1 &&
          session.bufferSize - removeSize > MAX_BUFFER_SIZE
        ) {
          removeSize += session.buffer[cutIndex].length
          cutIndex++
        }
        if (cutIndex > 0) {
          session.buffer.splice(0, cutIndex)
          session.bufferSize -= removeSize
        }
      }
      onData(id, data)
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
      if (this.destroying) return
      const current = this.sessions.get(id)
      if (!current) return
      current.status = 'exited'
      current.exitCode = exitCode
      this.sessions.delete(id)
      onExit(id, exitCode)
    })

    return this.buildDescriptor(session)
  }

  destroy(id: string): void {
    const session = this.sessions.get(id)

    // Session already removed (e.g., process exited naturally and onExit
    // cleaned it up). Nothing left to do — treat as a silent no-op.
    if (!session) {
      return
    }

    if (session.status === 'running') {
      try {
        session.pty.kill()
      } catch (err) {
        logger.warn('Failed to kill pty for session', { id, error: err })
      }
    }

    this.sessions.delete(id)
  }

  list(): SessionDescriptor[] {
    return Array.from(this.sessions.values()).map((session) =>
      this.buildDescriptor(session)
    )
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.getSession(id)
    if (session.status === 'running') {
      session.pty.resize(cols, rows)
    }
  }

  write(id: string, data: string): void {
    const session = this.getSession(id)
    if (session.status === 'running') {
      session.pty.write(data)
    }
  }

  rename(id: string, name: string): SessionDescriptor {
    const session = this.getSession(id)
    const trimmed = name.trim()
    session.name = trimmed.length > 0 ? trimmed : session.defaultName
    return this.buildDescriptor(session)
  }

  destroyAll(): void {
    this.destroying = true
    // Kill all ptys first, then clear the map in one shot to avoid
    // async onExit callbacks referencing already-deleted sessions
    for (const session of this.sessions.values()) {
      if (session.status === 'running') {
        try {
          session.pty.kill()
        } catch (err) {
          logger.warn('Failed to kill pty for session', {
            id: session.id,
            error: err
          })
        }
      }
    }
    this.sessions.clear()
    this.nextSessionNumber = 1
  }

  getBuffer(id: string): string {
    const session = this.getSession(id)
    if (session.buffer.length === 0) {
      return ''
    }
    return session.buffer.join('')
  }

  // Must stay synchronous — atomicity depends on single event-loop turn.
  // Adding `await` here would cause data loss between snapshot and clear.
  snapshotAndClearBuffer(id: string): string {
    const session = this.getSession(id)
    if (session.buffer.length === 0) {
      return ''
    }
    const snapshot = session.buffer.join('')
    session.buffer.length = 0
    session.bufferSize = 0
    return snapshot
  }

  private getSession(id: string): InternalSession {
    const session = this.sessions.get(id)
    if (!session) {
      throw new SessionNotFoundError(id)
    }
    return session
  }

  private buildDescriptor(session: InternalSession): SessionDescriptor {
    return {
      id: session.id,
      pid: session.pid,
      status: session.status,
      exitCode: session.exitCode,
      command: session.command,
      cwd: session.cwd,
      name: session.name,
      createdAt: session.createdAt
    }
  }
}
