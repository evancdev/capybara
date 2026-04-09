import { memo } from 'react'
import type { SessionStatus } from '@/shared/types/session'
import type { SessionState as AgentState } from '@/shared/types/messages'

interface StatusDotProps {
  status: SessionStatus
  exitCode?: number | null
  agentState?: AgentState
}

export const StatusDot = memo(function StatusDot({
  status,
  exitCode,
  agentState
}: StatusDotProps) {
  let cssClass: string
  let label: string

  if (status === 'exited') {
    cssClass = 'exited'
    label = `Exited (code ${exitCode ?? '?'})`
  } else if (agentState === 'requires_action') {
    cssClass = 'requires-action'
    label = 'Waiting for approval'
  } else if (agentState === 'running') {
    cssClass = 'running'
    label = 'Running'
  } else {
    // idle or undefined — if the session process is running, show idle;
    // otherwise fall back to running (matches pre-existing behavior when
    // no agent state message has arrived yet).
    if (agentState === 'idle') {
      cssClass = 'idle'
      label = 'Idle'
    } else {
      cssClass = 'running'
      label = 'Running'
    }
  }

  return (
    <span
      className={`status-dot ${cssClass}`}
      role="img"
      aria-label={label}
      title={label}
    />
  )
})
