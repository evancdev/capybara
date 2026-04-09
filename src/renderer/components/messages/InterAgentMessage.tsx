import { Streamdown } from 'streamdown'
import type { InterAgentMessage } from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'
import {
  codePlugin,
  STREAMDOWN_SECURITY_PROPS
} from '@/renderer/components/messages/streamdown'
import { useSession } from '@/renderer/context/SessionContext'

/**
 * Resolve a short fallback display for an unnamed session id.
 * Uses the first 8 characters of the id, matching the style used elsewhere
 * in the app for ephemeral session identifiers.
 */
function shortId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

export function InterAgentMessageBlock({
  message
}: {
  message: InterAgentMessage
}) {
  const { sessionNames } = useSession()
  // Display name is resolved at render time from SessionContext — main only
  // persists the verified fromSessionId, so the name always reflects the
  // sender's current name (even if the user renamed the session after the
  // message was sent).
  const displayName =
    sessionNames.get(message.fromSessionId) ?? shortId(message.fromSessionId)

  return (
    <div className={styles.interAgentRow}>
      <div className={styles.interAgentLabel}>From {displayName}</div>
      <div className={styles.interAgentText}>
        <Streamdown
          plugins={{ code: codePlugin }}
          mode="static"
          {...STREAMDOWN_SECURITY_PROPS}
        >
          {message.content}
        </Streamdown>
      </div>
    </div>
  )
}
