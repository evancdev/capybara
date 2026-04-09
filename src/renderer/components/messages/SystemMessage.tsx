import type {
  SystemMessage,
  UsageMessage,
  MetadataUpdated,
  SessionStateChange
} from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'

export function SystemMessageBlock({ message }: { message: SystemMessage }) {
  // init messages are hidden entirely — the startup animation covers this
  if (message.messageType === 'init') {
    return null
  }

  // compact_boundary — show a visual divider
  return (
    <div className={styles.systemDivider} role="status">
      <span className={styles.systemDividerLine}>context compacted</span>
    </div>
  )
}

export function UsageMessageBlock({ _message }: { _message: UsageMessage }) {
  // Usage messages are no longer rendered inline — cumulative tokens are
  // shown next to the elapsed timer in the status bar.
  return null
}

export function MetadataUpdatedBlock({
  _message
}: {
  _message: MetadataUpdated
}) {
  // metadata_updated messages are internal — they update the session banner,
  // not rendered as visible chat messages.
  return null
}

export function SessionStateBlock({
  message
}: {
  message: SessionStateChange
}) {
  // session_state is not rendered as a visible message normally.
  // Only 'requires_action' shows a subtle waiting indicator.
  if (message.state === 'requires_action') {
    return (
      <div
        className={styles.sessionWaiting}
        role="status"
        aria-label="Waiting for input"
      >
        <span className={styles.dimmedText}>Waiting for input...</span>
      </div>
    )
  }
  return null
}
