import { useRef, useCallback, useMemo } from 'react'
import type { Session } from '@/shared/types/session'
import type { ToolApprovalResponse } from '@/shared/types/messages'
import { useSession } from '@/renderer/context/SessionContext'
import { useMessages } from '@/renderer/context/MessageContext'
import { cx } from '@/renderer/lib/cx'
import { useSplitResize } from '@/renderer/hooks/useSplitResize'
import { MessagePanel } from '@/renderer/components/MessagePanel'
import { SplitDivider } from '@/renderer/components/SplitDivider'
import styles from '@/renderer/styles/SessionLayout.module.css'

interface SplitContainerProps {
  sessions: Session[]
  splitSessionIds: string[]
  activeSessionId: string | null
}

export function SplitContainer({
  sessions,
  splitSessionIds,
  activeSessionId
}: SplitContainerProps) {
  const { setActiveSession, activeProjectPath } = useSession()
  const {
    messages: getMessages,
    sessionMetadata: getMetadata,
    sendMessage,
    respondToToolApproval
  } = useMessages()
  const containerRef = useRef<HTMLDivElement>(null)

  const handleToolApprovalResponse = useCallback(
    (response: ToolApprovalResponse) => {
      void respondToToolApproval(response)
    },
    [respondToToolApproval]
  )

  const { panelSizes, onDividerMouseDown } = useSplitResize({
    panelCount: splitSessionIds.length,
    containerRef
  })

  const sessionMap = useMemo(
    () => new Map(sessions.map((s) => [s.id, s])),
    [sessions]
  )

  return (
    <div className={styles.splitContainer} ref={containerRef}>
      {splitSessionIds.map((id, i) => {
        const session = sessionMap.get(id)
        if (!session) return null

        const isActive = id === activeSessionId

        return (
          <div key={id} style={{ display: 'contents' }}>
            {i > 0 && (
              <SplitDivider
                onMouseDown={(e) => {
                  onDividerMouseDown(i - 1, e)
                }}
              />
            )}
            <div
              id={`agent-panel-${id}`}
              role="tabpanel"
              aria-labelledby={`agent-tab-${id}`}
              className={cx(
                styles.sessionPanel,
                isActive && styles.splitPanelActive
              )}
              style={{ flex: `0 0 ${panelSizes[i]}%`, display: 'flex' }}
              onClick={() => {
                if (!isActive) {
                  setActiveSession(id)
                }
              }}
            >
              <MessagePanel
                sessionId={session.id}
                messages={getMessages(session.id)}
                onRespondToToolApproval={handleToolApprovalResponse}
                onSendMessage={sendMessage}
                cwd={activeProjectPath ?? undefined}
                descriptorMetadata={session.metadata}
                liveMetadata={getMetadata(session.id)}
                session={session}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
