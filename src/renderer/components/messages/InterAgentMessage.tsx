import { Streamdown } from 'streamdown'
import type { InterAgentMessage } from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'
import {
  codePlugin,
  STREAMDOWN_SECURITY_PROPS
} from '@/renderer/components/messages/streamdown'

export function InterAgentMessageBlock({
  message
}: {
  message: InterAgentMessage
}) {
  return (
    <div className={styles.interAgentRow}>
      <div className={styles.interAgentLabel}>
        From {message.fromSessionName}
      </div>
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
