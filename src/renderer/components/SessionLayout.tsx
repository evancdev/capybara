import { useEffect } from 'react'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import { useSession } from '@/renderer/context/SessionContext'
import { useError } from '@/renderer/context/ErrorContext'
import { TerminalPanel } from '@/renderer/components/TerminalPanel'
import { Sidebar } from '@/renderer/components/Sidebar'
import { EmptyState, ErrorBar } from '@/renderer/ui'
import styles from '@/renderer/styles/SessionLayout.module.css'

export function SessionLayout() {
  const {
    projects,
    activeProjectPath,
    activeSessionId,
    createAgent,
    resumeConversation,
    destroyAgent,
    renameAgent,
    setActiveSession,
    openProject
  } = useSession()

  const { lastError, clearError } = useError()

  // Auto-clear error after 5 seconds
  useEffect(() => {
    if (!lastError) return
    const timer = setTimeout(clearError, 5000)
    return () => {
      clearTimeout(timer)
    }
  }, [lastError, clearError])

  const project =
    activeProjectPath !== null ? projects.get(activeProjectPath) : undefined

  if (!project) {
    return (
      <div className={styles.layout}>
        <EmptyState
          title="No project open"
          text="Open a project directory to get started"
          actionLabel="Open Project"
          onAction={() => {
            void openProject()
          }}
        />
      </div>
    )
  }

  const sessions = project.sessions
  const runningCount = sessions.filter((s) => s.status === 'running').length
  const atCap = runningCount >= MAX_AGENTS_PER_PROJECT

  return (
    <div className={styles.layout}>
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        projectPath={project.path}
        runningCount={runningCount}
        atCap={atCap}
        onSelectSession={setActiveSession}
        onCreateAgent={() => {
          void createAgent(project.path)
        }}
        onResumeConversation={(conversationId) => {
          void resumeConversation(project.path, conversationId)
        }}
        onDestroyAgent={(id) => {
          void destroyAgent(id)
        }}
        onRenameAgent={(id, name) => {
          void renameAgent(id, name)
        }}
      />
      <div className={styles.mainContent}>
        {lastError !== null && lastError !== '' ? (
          <ErrorBar message={lastError} onDismiss={clearError} />
        ) : null}
        {sessions.length > 0 ? (
          sessions.map((session) => (
            <div
              key={session.id}
              id={`agent-panel-${session.id}`}
              role="tabpanel"
              aria-labelledby={`agent-tab-${session.id}`}
              className={styles.terminalContainer}
              style={{
                display: session.id === activeSessionId ? 'flex' : 'none',
                flex: 1
              }}
            >
              <TerminalPanel sessionId={session.id} cwd={session.cwd} />
            </div>
          ))
        ) : (
          <EmptyState
            title="No agent selected"
            text="Create an agent to get started"
            actionLabel={atCap ? undefined : 'Create Agent'}
            onAction={
              atCap
                ? undefined
                : () => {
                    void createAgent(project.path)
                  }
            }
          />
        )}
      </div>
    </div>
  )
}
