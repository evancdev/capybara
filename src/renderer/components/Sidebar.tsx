import { useState } from 'react'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import type { SessionDescriptor } from '@/shared/types/session'
import { StatusDot, CloseButton, InlineRenameInput } from '@/renderer/ui'
import { ConversationHistory } from '@/renderer/components/ConversationHistory'
import styles from '@/renderer/styles/Sidebar.module.css'

interface SidebarProps {
  sessions: SessionDescriptor[]
  activeSessionId: string | null
  projectPath: string
  runningCount: number
  atCap: boolean
  onSelectSession: (id: string) => void
  onCreateAgent: () => void
  onResumeConversation: (conversationId: string) => void
  onDestroyAgent: (id: string) => void
  onRenameAgent: (id: string, name: string) => void
}

export function Sidebar({
  sessions,
  activeSessionId,
  projectPath,
  runningCount,
  atCap,
  onSelectSession,
  onCreateAgent,
  onResumeConversation,
  onDestroyAgent,
  onRenameAgent
}: SidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null)

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        Agents {runningCount}/{MAX_AGENTS_PER_PROJECT}
      </div>
      <div
        className={styles.agentList}
        role="tablist"
        aria-label="Agent sessions"
      >
        {sessions.map((session) => (
          <div
            key={session.id}
            id={`agent-tab-${session.id}`}
            role="tab"
            tabIndex={session.id === activeSessionId ? 0 : -1}
            aria-selected={session.id === activeSessionId}
            aria-controls={`agent-panel-${session.id}`}
            className={`${styles.agentTab} ${session.id === activeSessionId ? styles.active : ''}`}
            style={
              closingSessionId === session.id
                ? { opacity: 0.5, pointerEvents: 'none' }
                : undefined
            }
            onClick={() => {
              onSelectSession(session.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'F2') {
                e.preventDefault()
                setEditingSessionId(session.id)
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectSession(session.id)
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const tabs =
                  e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                    '[role="tab"]'
                  )
                if (!tabs || tabs.length === 0) return
                const currentIdx = Array.from(tabs).indexOf(
                  e.currentTarget as HTMLElement
                )
                const nextIdx =
                  e.key === 'ArrowDown'
                    ? (currentIdx + 1) % tabs.length
                    : (currentIdx - 1 + tabs.length) % tabs.length
                tabs[nextIdx].focus()
              }
            }}
          >
            <StatusDot status={session.status} exitCode={session.exitCode} />
            {editingSessionId === session.id ? (
              <InlineRenameInput
                initialValue={session.name}
                onCommit={(name) => {
                  setEditingSessionId(null)
                  onRenameAgent(session.id, name)
                }}
                onCancel={() => {
                  setEditingSessionId(null)
                }}
              />
            ) : (
              <span
                className={styles.agentName}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingSessionId(session.id)
                }}
              >
                {session.name}
              </span>
            )}
            <CloseButton
              label="Remove agent"
              onClick={(e) => {
                e.stopPropagation()
                if (editingSessionId === session.id) {
                  setEditingSessionId(null)
                }
                setClosingSessionId(session.id)
                onDestroyAgent(session.id)
              }}
            />
          </div>
        ))}
      </div>
      <ConversationHistory
        projectPath={projectPath}
        onResume={onResumeConversation}
      />
      <div className={styles.footer}>
        <button
          className={styles.newAgentBtn}
          disabled={atCap}
          title={
            atCap
              ? `Maximum ${MAX_AGENTS_PER_PROJECT} agents reached`
              : undefined
          }
          onClick={onCreateAgent}
        >
          + New Agent
        </button>
        {atCap ? (
          <div className={styles.capMessage}>
            Maximum {MAX_AGENTS_PER_PROJECT} agents reached
          </div>
        ) : null}
      </div>
    </div>
  )
}
