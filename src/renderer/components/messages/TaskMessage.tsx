import type { TaskUpdate } from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'

export function TaskUpdateBlock({ message }: { message: TaskUpdate }) {
  const text = message.description ?? message.summary ?? ''
  const fallback = text || `task ${message.taskId}`

  switch (message.status) {
    case 'started':
      return (
        <div
          className={`${styles.taskUpdateRow} ${styles.taskStarted}`}
          role="status"
        >
          <span className={styles.taskIndicator} aria-hidden="true">
            {'\u25B8'}
          </span>
          <span className={styles.taskText}>Task started: {fallback}</span>
        </div>
      )
    case 'progress': {
      const progressText = message.summary ?? message.description ?? fallback
      return (
        <div
          className={`${styles.taskUpdateRow} ${styles.taskProgress}`}
          role="status"
        >
          <span className={styles.taskIndent} aria-hidden="true">
            {' '}
          </span>
          <span className={styles.taskIndicator} aria-hidden="true">
            {'\u21B3'}
          </span>
          <span className={styles.taskText}>{progressText}</span>
        </div>
      )
    }
    case 'completed': {
      const completedText = message.summary ?? message.description ?? fallback
      return (
        <div
          className={`${styles.taskUpdateRow} ${styles.taskCompleted}`}
          role="status"
        >
          <span className={styles.taskCompletedIndicator} aria-hidden="true">
            {'\u2713'}
          </span>
          <span className={styles.taskText}>
            Task completed: {completedText}
          </span>
        </div>
      )
    }
    default:
      return null
  }
}
