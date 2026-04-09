import type { UserMessage } from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'

export function UserMessageBlock({ message }: { message: UserMessage }) {
  return (
    <div className={styles.userMessage}>
      <span className={styles.userPromptSymbol} aria-hidden="true">
        {'>'}
      </span>
      <span className={styles.userText}>{message.text}</span>
    </div>
  )
}
