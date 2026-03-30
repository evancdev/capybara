import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo
} from 'react'
import type { ReactNode } from 'react'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import type { SessionDescriptor } from '@/shared/types/session'
import { useError } from '@/renderer/context/ErrorContext'
import { useTerminalDispatch } from '@/renderer/context/TerminalDispatchContext'

export interface Project {
  path: string
  name: string
  sessions: SessionDescriptor[]
}

interface SessionContextValue {
  projects: Map<string, Project>
  activeProjectPath: string | null
  activeSessionId: string | null
  closingProjectPath: string | null
  openProject: () => Promise<void>
  closeProject: (path: string) => Promise<void>
  createAgent: (projectPath: string, name?: string) => Promise<void>
  resumeConversation: (
    projectPath: string,
    conversationId: string
  ) => Promise<void>
  destroyAgent: (sessionId: string) => Promise<void>
  renameAgent: (sessionId: string, name: string) => Promise<void>
  setActiveProject: (path: string) => void
  setActiveSession: (id: string) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return ctx
}

function removeSessionFromProjects(
  projects: Map<string, Project>,
  sessionId: string
): { next: Map<string, Project>; nextActiveId: string | null } | null {
  const next = new Map<string, Project>(projects)
  for (const [path, project] of next) {
    const idx = project.sessions.findIndex((s) => s.id === sessionId)
    if (idx !== -1) {
      const updatedSessions = project.sessions.filter((s) => s.id !== sessionId)
      next.set(path, { ...project, sessions: updatedSessions })
      const nextActiveId =
        updatedSessions.length > 0
          ? updatedSessions[updatedSessions.length - 1].id
          : null
      return { next, nextActiveId }
    }
  }
  return null
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setError } = useError()
  const { dispatchTerminalOutput } = useTerminalDispatch()

  const [projects, setProjects] = useState(new Map<string, Project>())
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(
    null
  )
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [closingProjectPath, setClosingProjectPath] = useState<string | null>(
    null
  )

  const stateRef = useRef({
    projects,
    activeSessionId,
    activeProjectPath,
    closingProjectPath
  })
  useEffect(() => {
    stateRef.current = {
      projects,
      activeSessionId,
      activeProjectPath,
      closingProjectPath
    }
  }, [projects, activeSessionId, activeProjectPath, closingProjectPath])

  // Register ONE global terminal output listener + session exited listener
  useEffect(() => {
    window.sessionAPI.onTerminalOutput((sessionId: string, data: string) => {
      dispatchTerminalOutput(sessionId, data)
    })

    window.sessionAPI.onSessionExited((sessionId: string, exitCode: number) => {
      setProjects((prev) => {
        const next = new Map<string, Project>(prev)
        for (const [path, project] of next) {
          const idx = project.sessions.findIndex((s) => s.id === sessionId)
          if (idx !== -1) {
            const updatedSessions = [...project.sessions]
            updatedSessions[idx] = {
              ...updatedSessions[idx],
              status: 'exited',
              exitCode
            }
            next.set(path, { ...project, sessions: updatedSessions })
            return next
          }
        }
        return prev
      })
    })

    return () => {
      window.sessionAPI.offTerminalOutput()
      window.sessionAPI.offSessionExited()
    }
  }, [dispatchTerminalOutput])

  const openProject = useCallback(async () => {
    const dirPath = await window.sessionAPI.selectDirectory()
    if (dirPath === null || dirPath === '') return

    setProjects((prev) => {
      if (prev.has(dirPath)) {
        return prev
      }
      const name = dirPath.split(/[\\/]/).pop() ?? dirPath
      const next = new Map<string, Project>(prev)
      next.set(dirPath, { path: dirPath, name, sessions: [] })
      return next
    })

    const existing = stateRef.current.projects.get(dirPath)
    setActiveProjectPath(dirPath)
    if (existing && existing.sessions.length > 0) {
      setActiveSessionId(existing.sessions[0].id)
    } else {
      setActiveSessionId(null)
    }
  }, [])

  const closeProject = useCallback(async (path: string) => {
    // F6: Re-entrancy guard — prevent double-close from parallel invocations
    if (stateRef.current.closingProjectPath !== null) return

    const project = stateRef.current.projects.get(path)
    if (!project) return

    // F5: Confirm before closing a project with running sessions
    const runningSessions = project.sessions.filter(
      (s) => s.status === 'running'
    )
    if (runningSessions.length > 0) {
      const confirmed = window.confirm(
        `Close project? This will terminate ${runningSessions.length} running agent(s).`
      )
      if (!confirmed) return
    }

    setClosingProjectPath(path)

    await Promise.allSettled(
      project.sessions.map((session) =>
        window.sessionAPI.destroySession(session.id).catch((err: unknown) => {
          console.error('Failed to destroy session during project close:', err)
        })
      )
    )

    const needsActiveSwitch = stateRef.current.activeProjectPath === path
    let newActivePath: string | null = null

    if (needsActiveSwitch) {
      const remaining = Array.from(stateRef.current.projects.keys()).filter(
        (k) => k !== path
      )
      newActivePath = remaining.length > 0 ? remaining[0] : null
    }

    setProjects((prev) => {
      const next = new Map<string, Project>(prev)
      next.delete(path)
      return next
    })

    if (needsActiveSwitch) {
      setActiveProjectPath(newActivePath)
      setActiveSessionId(null)
    }

    setClosingProjectPath(null)
  }, [])

  const startSession = useCallback(
    async (
      projectPath: string,
      input: { cwd: string; name?: string; resumeConversationId?: string },
      errorLabel: string
    ) => {
      const project = stateRef.current.projects.get(projectPath)
      if (!project) return

      const runningSessions = project.sessions.filter(
        (s) => s.status === 'running'
      )
      if (runningSessions.length >= MAX_AGENTS_PER_PROJECT) return

      try {
        const session = await window.sessionAPI.createSession(input)

        setProjects((prev) => {
          const next = new Map<string, Project>(prev)
          const p = next.get(projectPath)
          if (p) {
            next.set(projectPath, {
              ...p,
              sessions: [...p.sessions, session]
            })
          }
          return next
        })

        setActiveSessionId(session.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : errorLabel
        setError(message)
        console.error(`${errorLabel}:`, err)
      }
    },
    [setError]
  )

  const createAgent = useCallback(
    (projectPath: string, name?: string) =>
      startSession(
        projectPath,
        { cwd: projectPath, name },
        'Failed to create agent'
      ),
    [startSession]
  )

  const resumeConversation = useCallback(
    (projectPath: string, conversationId: string) =>
      startSession(
        projectPath,
        { cwd: projectPath, resumeConversationId: conversationId },
        'Failed to resume conversation'
      ),
    [startSession]
  )

  const destroyAgent = useCallback(async (sessionId: string) => {
    try {
      await window.sessionAPI.destroySession(sessionId)
    } catch (err) {
      console.error('Failed to destroy session:', err)
    }

    const needsActiveSwitch = stateRef.current.activeSessionId === sessionId
    let nextActiveId: string | null = null

    setProjects((prev) => {
      const r = removeSessionFromProjects(prev, sessionId)
      if (r) {
        nextActiveId = r.nextActiveId
        return r.next
      }
      return prev
    })

    if (needsActiveSwitch) {
      setActiveSessionId(nextActiveId)
    }
  }, [])

  const renameAgent = useCallback(
    async (sessionId: string, name: string) => {
      try {
        const updated = await window.sessionAPI.renameSession(sessionId, name)

        setProjects((prev) => {
          const next = new Map<string, Project>(prev)
          for (const [path, project] of next) {
            const idx = project.sessions.findIndex((s) => s.id === sessionId)
            if (idx !== -1) {
              const updatedSessions = [...project.sessions]
              updatedSessions[idx] = updated
              next.set(path, { ...project, sessions: updatedSessions })
              break
            }
          }
          return next
        })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to rename agent'
        setError(message)
        console.error('Failed to rename agent:', err)
      }
    },
    [setError]
  )

  const setActiveProject = useCallback((path: string) => {
    setActiveProjectPath(path)
    const project = stateRef.current.projects.get(path)
    if (project && project.sessions.length > 0) {
      setActiveSessionId(project.sessions[0].id)
    } else {
      setActiveSessionId(null)
    }
  }, [])

  const setActiveSessionDirect = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({
      projects,
      activeProjectPath,
      activeSessionId,
      closingProjectPath,
      openProject,
      closeProject,
      createAgent,
      resumeConversation,
      destroyAgent,
      renameAgent,
      setActiveProject,
      setActiveSession: setActiveSessionDirect
    }),
    [
      projects,
      activeProjectPath,
      activeSessionId,
      closingProjectPath,
      openProject,
      closeProject,
      createAgent,
      resumeConversation,
      destroyAgent,
      renameAgent,
      setActiveProject,
      setActiveSessionDirect
    ]
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
