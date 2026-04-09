import type { Session } from '@/shared/types/session'
import styles from '@/renderer/styles/SessionStatusStrip.module.css'

export interface SessionStatusStripProps {
  session: Session | undefined
  cwd?: string
}

function truncateId(id: string): string {
  return id.slice(0, 8)
}

export function SessionStatusStrip({ session, cwd }: SessionStatusStripProps) {
  if (!session) return null

  const model = session.metadata?.model ?? 'unknown'
  const shortId = truncateId(session.id)

  return (
    <div className={styles.strip} aria-label="Session info">
      <span>{model}</span>
      {cwd !== undefined && cwd !== '' ? (
        <>
          <span className={styles.separator} aria-hidden="true">&middot;</span>
          <span>{cwd}</span>
        </>
      ) : null}
      <span className={styles.separator} aria-hidden="true">&middot;</span>
      <span className={styles.sessionId}>{shortId}</span>
    </div>
  )
}
