import { useCallback, useEffect } from 'react'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import { useSession } from '@/renderer/context/SessionContext'
import { useError } from '@/renderer/context/ErrorContext'
import { useMessages } from '@/renderer/context/MessageContext'
import { MessagePanel } from '@/renderer/components/MessagePanel'
import { SplitContainer } from '@/renderer/components/SplitContainer'
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
    sessionNames,
    renameAgent,
    reorderSessions,
    splitSessionIds,
    addToSplit,
    removeFromSplit,
    setActiveSession,
    openProject
  } = useSession()

  const { lastError, clearError } = useError()
  const {
    messages: getMessages,
    sessionMetadata: getMetadata,
    sendMessage,
    respondToToolApproval,
    loadMessages
  } = useMessages()

  const handleToolApprovalResponse = useCallback(
    (response: Parameters<typeof respondToToolApproval>[0]) => {
      void respondToToolApproval(response)
    },
    [respondToToolApproval]
  )

  // When the active session changes, load any existing messages from the
  // backend. This is critical for resumed conversations: the backend
  // pre-loads the conversation history from the .jsonl file, and this
  // fetch seeds the renderer's message store so prior messages appear
  // immediately. For new sessions the backend returns an empty array,
  // making this a no-op.
  useEffect(() => {
    if (activeSessionId !== null) {
      void loadMessages(activeSessionId)
    }
  }, [activeSessionId, loadMessages])

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
        splitSessionIds={splitSessionIds}
        sessionNames={sessionNames}
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
        onRenameAgent={renameAgent}
        onReorderSessions={(from, to) => {
          reorderSessions(project.path, from, to)
        }}
        onAddToSplit={addToSplit}
        onRemoveFromSplit={removeFromSplit}
      />
      <div className={styles.mainContent}>
        {lastError !== null && lastError !== '' ? (
          <ErrorBar message={lastError} onDismiss={clearError} />
        ) : null}
        {sessions.length > 0 ? (
          <>
            {splitSessionIds.length >= 2 ? (
              <SplitContainer
                sessions={sessions}
                splitSessionIds={splitSessionIds}
                activeSessionId={activeSessionId}
              />
            ) : null}
            {sessions.map((session) => {
              const inSplit = splitSessionIds.includes(session.id)
              // In split mode, non-split sessions are hidden.
              // Split sessions are rendered by SplitContainer.
              // In single mode, only active session is shown.
              const visible =
                splitSessionIds.length >= 2
                  ? false
                  : session.id === activeSessionId
              return (
                <div
                  key={session.id}
                  id={
                    inSplit
                      ? `agent-panel-hidden-${session.id}`
                      : `agent-panel-${session.id}`
                  }
                  role={inSplit ? undefined : 'tabpanel'}
                  aria-labelledby={
                    inSplit ? undefined : `agent-tab-${session.id}`
                  }
                  className={styles.sessionPanel}
                  style={{
                    display: visible ? 'flex' : 'none',
                    flex: 1
                  }}
                >
                  {inSplit ? null : (
                    <MessagePanel
                      sessionId={session.id}
                      messages={getMessages(session.id)}
                      onRespondToToolApproval={handleToolApprovalResponse}
                      onSendMessage={sendMessage}
                      cwd={project.path}
                      descriptorMetadata={session.metadata}
                      liveMetadata={getMetadata(session.id)}
                    />
                  )}
                </div>
              )
            })}
          </>
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
