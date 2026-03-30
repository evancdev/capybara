import { memo } from 'react'
import type { SessionStatus } from '@/shared/types/session'

interface StatusDotProps {
  status: SessionStatus
  exitCode?: number | null
}

export const StatusDot = memo(function StatusDot({
  status,
  exitCode
}: StatusDotProps) {
  const label =
    status === 'exited' ? `Exited (code ${exitCode ?? '?'})` : 'Running'

  return (
    <span
      className={`status-dot ${status}`}
      role="img"
      aria-label={label}
      title={label}
    />
  )
})
