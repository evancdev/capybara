import {
  createContext,
  useContext,
  useCallback,
  useEffect,
<<<<<<< Updated upstream
  useMemo,
  useRef,
  useSyncExternalStore
=======
<<<<<<< Updated upstream
  useRef,
  useMemo
=======
  useMemo,
  useState,
  useSyncExternalStore
>>>>>>> Stashed changes
>>>>>>> Stashed changes
} from 'react'
import type { ReactNode } from 'react'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import type { Session } from '@/shared/types/session'
import { useError } from '@/renderer/context/ErrorContext'

export interface Project {
  path: string
  name: string
  sessions: Session[]
}

interface SessionContextValue {
  projects: Map<string, Project>
  activeProjectPath: string | null
  activeSessionId: string | null
  closingProjectPath: string | null
  openProject: () => Promise<void>
  closeProject: (path: string) => Promise<void>
  createAgent: (projectPath: string) => Promise<void>
  resumeConversation: (
    projectPath: string,
    conversationId: string
  ) => Promise<void>
  destroyAgent: (sessionId: string) => Promise<void>
  sessionNames: Map<string, string>
  renameAgent: (sessionId: string, name: string) => void
  reorderSessions: (
    projectPath: string,
    fromIndex: number,
    toIndex: number
  ) => void
  splitSessionIds: string[]
  addToSplit: (sessionId: string) => void
  removeFromSplit: (sessionId: string) => void
  exitSplitMode: () => void
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

// ---------------------------------------------------------------------------
// External store
// ---------------------------------------------------------------------------
//
// ADR-012: state that needs to be read imperatively from callbacks (without
// risking stale closures) lives in a tiny external store exposed via
// useSyncExternalStore. This replaces the earlier `stateRef` / `useEffect`
// mirror pattern, which was easy to get wrong because the ref lagged state
// by one commit.
//
// The store owns a single immutable snapshot object. Mutations produce a
// new snapshot (so useSyncExternalStore's Object.is check triggers a
// re-render) and notify subscribers synchronously.

interface SessionState {
  projects: Map<string, Project>
  activeProjectPath: string | null
  activeSessionId: string | null
  closingProjectPath: string | null
  splitSessionIds: string[]
  sessionNames: Map<string, string>
}

type Updater = (prev: SessionState) => SessionState

interface SessionStore {
  getSnapshot: () => SessionState
  subscribe: (listener: () => void) => () => void
  update: (updater: Updater) => void
}

function createSessionStore(): SessionStore {
  let snapshot: SessionState = {
    projects: new Map(),
    activeProjectPath: null,
    activeSessionId: null,
    closingProjectPath: null,
    splitSessionIds: [],
    sessionNames: new Map()
  }
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (updater) => {
      const next = updater(snapshot)
      if (next === snapshot) return
      snapshot = next
      for (const listener of listeners) listener()
    }
  }
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

<<<<<<< Updated upstream
  // One store per provider instance. Stable ref so callbacks don't re-bind.
  const storeRef = useRef<SessionStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = createSessionStore()
  }
  const store = storeRef.current
=======
<<<<<<< Updated upstream
  const [projects, setProjects] = useState(new Map<string, Project>())
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(
    null
  )
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [closingProjectPath, setClosingProjectPath] = useState<string | null>(
    null
  )
=======
  // One store per provider instance. Lazy initializer keeps the value stable
  // across re-renders without the refs-during-render lint pitfall.
  // eslint-disable-next-line react/hook-use-state -- lazy singleton; setter is unused
  const [store] = useState<SessionStore>(() => createSessionStore())
>>>>>>> Stashed changes
>>>>>>> Stashed changes

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  // Listen for session exit events from the backend
  useEffect(() => {
    return window.sessionAPI.onSessionExited(
      (sessionId: string, exitCode: number) => {
        store.update((prev) => {
          const nextProjects = new Map<string, Project>(prev.projects)
          let changed = false
          for (const [path, project] of nextProjects) {
            const idx = project.sessions.findIndex((s) => s.id === sessionId)
            if (idx !== -1) {
              const updatedSessions = [...project.sessions]
              updatedSessions[idx] = {
                ...updatedSessions[idx],
                status: 'exited',
                exitCode
              }
              nextProjects.set(path, {
                ...project,
                sessions: updatedSessions
              })
              changed = true
              break
            }
          }
          if (!changed) return prev
          return { ...prev, projects: nextProjects }
        })
      }
    )
  }, [store])

  const openProject = useCallback(async () => {
    const dirPath = await window.sessionAPI.selectDirectory()
    if (dirPath === null || dirPath === '') return

    store.update((prev) => {
      const existing = prev.projects.get(dirPath)
      if (existing) {
        // Project already open — just activate it.
        return {
          ...prev,
          activeProjectPath: dirPath,
          activeSessionId:
            existing.sessions.length > 0 ? existing.sessions[0].id : null
        }
      }
      const name = dirPath.split(/[\\/]/).pop() ?? dirPath
      const nextProjects = new Map<string, Project>(prev.projects)
      nextProjects.set(dirPath, { path: dirPath, name, sessions: [] })
      return {
        ...prev,
        projects: nextProjects,
        activeProjectPath: dirPath,
        activeSessionId: null
      }
    })
  }, [store])

  const closeProject = useCallback(
    async (path: string) => {
      // F6: Re-entrancy guard — prevent double-close from parallel invocations
      const current = store.getSnapshot()
      if (current.closingProjectPath !== null) return

      const project = current.projects.get(path)
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

      store.update((prev) => ({ ...prev, closingProjectPath: path }))

      await Promise.allSettled(
        project.sessions.map((session) =>
          window.sessionAPI.destroySession(session.id).catch((err: unknown) => {
            console.error(
              '[SessionContext]',
              'destroySession failed during project close',
              err
            )
          })
        )
      )

      store.update((prev) => {
        const nextProjects = new Map<string, Project>(prev.projects)
        nextProjects.delete(path)

        const needsActiveSwitch = prev.activeProjectPath === path
        let nextActivePath = prev.activeProjectPath
        let nextActiveSessionId = prev.activeSessionId
        let nextSplit = prev.splitSessionIds

        if (needsActiveSwitch) {
          const remaining = Array.from(nextProjects.keys())
          nextActivePath = remaining.length > 0 ? remaining[0] : null
          nextActiveSessionId = null
          nextSplit = []
        }

        return {
          ...prev,
          projects: nextProjects,
          activeProjectPath: nextActivePath,
          activeSessionId: nextActiveSessionId,
          splitSessionIds: nextSplit,
          closingProjectPath: null
        }
      })
    },
    [store]
  )

  const startSession = useCallback(
    async (
      projectPath: string,
      input: { cwd: string; resumeConversationId?: string },
      errorLabel: string
    ) => {
      const project = store.getSnapshot().projects.get(projectPath)
      if (!project) return

      const runningSessions = project.sessions.filter(
        (s) => s.status === 'running'
      )
      if (runningSessions.length >= MAX_AGENTS_PER_PROJECT) return

      try {
        const session = await window.sessionAPI.createSession(input)

        store.update((prev) => {
          const nextProjects = new Map<string, Project>(prev.projects)
          const p = nextProjects.get(projectPath)
          if (!p) return prev
          nextProjects.set(projectPath, {
            ...p,
            sessions: [...p.sessions, session]
          })
          return {
            ...prev,
            projects: nextProjects,
            activeSessionId: session.id
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : errorLabel
        setError(message)
        console.error('[SessionContext]', errorLabel, err)
      }
    },
    [setError, store]
  )

  const createAgent = useCallback(
    (projectPath: string) =>
      startSession(projectPath, { cwd: projectPath }, 'Failed to create agent'),
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

  const destroyAgent = useCallback(
    async (sessionId: string) => {
      try {
        await window.sessionAPI.destroySession(sessionId)
      } catch (err) {
        console.error('[SessionContext]', 'destroySession failed', err)
      }

      store.update((prev) => {
        const r = removeSessionFromProjects(prev.projects, sessionId)
        if (!r) return prev

        const needsActiveSwitch = prev.activeSessionId === sessionId
        const nextActiveSessionId = needsActiveSwitch
          ? r.nextActiveId
          : prev.activeSessionId

        // Drop any rename stored for the destroyed session.
        let nextNames = prev.sessionNames
        if (nextNames.has(sessionId)) {
          nextNames = new Map(nextNames)
          nextNames.delete(sessionId)
        }

        // Clean up split state
        let nextSplit = prev.splitSessionIds
        if (nextSplit.includes(sessionId)) {
          const remaining = nextSplit.filter((id) => id !== sessionId)
          nextSplit = remaining.length <= 1 ? [] : remaining
        }

        return {
          ...prev,
          projects: r.next,
          activeSessionId: nextActiveSessionId,
          sessionNames: nextNames,
          splitSessionIds: nextSplit
        }
      })
    },
    [store]
  )

  const renameAgent = useCallback(
    (sessionId: string, name: string) => {
      store.update((prev) => {
        const nextNames = new Map(prev.sessionNames)
        const trimmed = name.trim()
        if (trimmed.length > 0) {
          nextNames.set(sessionId, trimmed)
        } else {
          nextNames.delete(sessionId)
        }
        return { ...prev, sessionNames: nextNames }
      })
    },
    [store]
  )

  const reorderSessions = useCallback(
    (projectPath: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return
      store.update((prev) => {
        const project = prev.projects.get(projectPath)
        if (!project) return prev
        const sessions = [...project.sessions]
        const [moved] = sessions.splice(fromIndex, 1)
        sessions.splice(toIndex, 0, moved)
        const nextProjects = new Map(prev.projects)
        nextProjects.set(projectPath, { ...project, sessions })
        return { ...prev, projects: nextProjects }
      })
    },
    [store]
  )

  const addToSplit = useCallback(
    (sessionId: string) => {
      store.update((prev) => {
        if (prev.splitSessionIds.includes(sessionId)) return prev
        const nextSplit =
          prev.splitSessionIds.length === 0 && prev.activeSessionId
            ? [prev.activeSessionId, sessionId]
            : [...prev.splitSessionIds, sessionId]
        return {
          ...prev,
          splitSessionIds: nextSplit,
          activeSessionId: sessionId
        }
      })
    },
    [store]
  )

  const removeFromSplit = useCallback(
    (sessionId: string) => {
      store.update((prev) => {
        const remaining = prev.splitSessionIds.filter((id) => id !== sessionId)
        if (remaining.length <= 1) {
          return {
            ...prev,
            splitSessionIds: [],
            activeSessionId:
              remaining.length === 1 ? remaining[0] : prev.activeSessionId
          }
        }
        return {
          ...prev,
          splitSessionIds: remaining,
          activeSessionId:
            prev.activeSessionId === sessionId
              ? remaining[0]
              : prev.activeSessionId
        }
      })
    },
    [store]
  )

  const exitSplitMode = useCallback(() => {
    store.update((prev) =>
      prev.splitSessionIds.length === 0
        ? prev
        : { ...prev, splitSessionIds: [] }
    )
  }, [store])

  const setActiveProject = useCallback(
    (path: string) => {
      store.update((prev) => {
        const project = prev.projects.get(path)
        return {
          ...prev,
          activeProjectPath: path,
          activeSessionId:
            project && project.sessions.length > 0
              ? project.sessions[0].id
              : null
        }
      })
    },
    [store]
  )

  const setActiveSessionDirect = useCallback(
    (id: string) => {
      store.update((prev) =>
        prev.activeSessionId === id ? prev : { ...prev, activeSessionId: id }
      )
    },
    [store]
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      projects: state.projects,
      activeProjectPath: state.activeProjectPath,
      activeSessionId: state.activeSessionId,
      closingProjectPath: state.closingProjectPath,
      openProject,
      closeProject,
      createAgent,
      resumeConversation,
      destroyAgent,
      sessionNames: state.sessionNames,
      renameAgent,
      reorderSessions,
      splitSessionIds: state.splitSessionIds,
      addToSplit,
      removeFromSplit,
      exitSplitMode,
      setActiveProject,
      setActiveSession: setActiveSessionDirect
    }),
    [
      state,
      openProject,
      closeProject,
      createAgent,
      resumeConversation,
      destroyAgent,
      renameAgent,
      reorderSessions,
      addToSplit,
      removeFromSplit,
      exitSplitMode,
      setActiveProject,
      setActiveSessionDirect
    ]
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}
