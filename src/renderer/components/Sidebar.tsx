import { useMemo, useState } from 'react'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import type { Session } from '@/shared/types/session'
import { useSortableDrag } from '@/renderer/hooks/useSortableDrag'
import { cx } from '@/renderer/lib/cx'
import { handleTabArrowNav } from '@/renderer/lib/tab-nav'
import { StatusDot, CloseButton, InlineRenameInput } from '@/renderer/ui'
import { ConversationHistory } from '@/renderer/components/ConversationHistory'
import styles from '@/renderer/styles/Sidebar.module.css'

interface SidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  projectPath: string
  runningCount: number
  atCap: boolean
  splitSessionIds: string[]
  sessionNames: Map<string, string>
  onSelectSession: (id: string) => void
  onCreateAgent: () => void
  onResumeConversation: (conversationId: string) => void
  onDestroyAgent: (id: string) => void
  onRenameAgent: (id: string, name: string) => void
  onReorderSessions: (fromIndex: number, toIndex: number) => void
}

export function Sidebar({
  sessions,
  activeSessionId,
  projectPath,
  runningCount,
  atCap,
  splitSessionIds,
  onSelectSession,
  onCreateAgent,
  onResumeConversation,
  sessionNames,
  onDestroyAgent,
  onRenameAgent,
  onReorderSessions
}: SidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null)

  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions])

  const { dragState, getItemProps, listRef } = useSortableDrag({
    items: sessionIds,
    onReorder: onReorderSessions,
    isDisabled: (id) => id === editingSessionId || id === closingSessionId
  })

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        Agents {runningCount}/{MAX_AGENTS_PER_PROJECT}
      </div>
      <div
        className={styles.agentList}
        role="tablist"
        aria-label="Agent sessions"
        ref={listRef}
      >
        {sessions.map((session, index) => {
          const itemProps = getItemProps(session.id, index)
          const isClosing = closingSessionId === session.id
          const inSplit = splitSessionIds.includes(session.id)
          const isDragging = dragState?.draggingId === session.id

          const tabClass = cx(
            styles.agentTab,
            session.id === activeSessionId && styles.active,
            inSplit && session.id !== activeSessionId && styles.inSplit,
            isDragging && styles.dragging
          )

          return (
            <div
              key={session.id}
              id={`agent-tab-${session.id}`}
              role="tab"
              tabIndex={session.id === activeSessionId ? 0 : -1}
              aria-selected={session.id === activeSessionId}
              aria-controls={`agent-panel-${session.id}`}
              className={tabClass}
              style={{
                ...itemProps.style,
                ...(isClosing
                  ? { opacity: 0.5, pointerEvents: 'none' as const }
                  : {})
              }}
              data-drag-index={itemProps['data-drag-index']}
              onPointerDown={itemProps.onPointerDown}
              onClick={() => {
                onSelectSession(session.id)
              }}
              onKeyDown={(e) => {
                if (handleTabArrowNav(e, 'vertical')) return
                if (e.key === 'F2') {
                  e.preventDefault()
                  setEditingSessionId(session.id)
                } else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectSession(session.id)
                }
              }}
            >
              <StatusDot status={session.status} exitCode={session.exitCode} />
              {editingSessionId === session.id ? (
                <InlineRenameInput
                  initialValue={sessionNames.get(session.id) ?? `Agent ${index + 1}`}
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
                  {sessionNames.get(session.id) ?? `Agent ${index + 1}`}
                </span>
              )}
              {editingSessionId !== session.id && (
                <button
                  className={styles.renameBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingSessionId(session.id)
                  }}
                  aria-label="Rename agent"
                  title="Rename"
                >
                  &#9998;
                </button>
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
          )
        })}
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
