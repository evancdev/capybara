import type { Session } from '@/shared/types/session'
import styles from '@/renderer/styles/SessionStatusStrip.module.css'

export interface SessionStatusStripProps {
  session: Session | undefined
}

export function SessionStatusStrip({ session }: SessionStatusStripProps) {
  if (!session) return null

  const model = session.metadata?.model ?? null
  const role = session.role ?? null
  const branch = session.gitBranch ?? 'main'

  return (
    <div className={styles.strip} aria-label="Session info">
      {model !== null ? <span>{model}</span> : null}
      {role !== null ? (
        <>
          {model !== null ? (
            <span className={styles.separator} aria-hidden="true">&middot;</span>
          ) : null}
          <span>{role}</span>
        </>
      ) : null}
      {model !== null || role !== null ? (
        <span className={styles.separator} aria-hidden="true">&middot;</span>
      ) : null}
      <span>{branch}</span>
    </div>
  )
}
