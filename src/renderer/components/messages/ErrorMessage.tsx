import type { ErrorMessage } from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'

export function ErrorMessageBlock({ message }: { message: ErrorMessage }) {
  return (
    <div className={styles.errorRow} role="alert">
      <div>{message.message}</div>
      <div className={styles.errorCode}>{message.code}</div>
    </div>
  )
}
