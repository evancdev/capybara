import { memo } from 'react'
import { XTermWrapper } from '@/renderer/components/XTermWrapper'
import styles from '@/renderer/styles/TerminalPanel.module.css'

interface TerminalPanelProps {
  sessionId: string
  cwd: string
}

export const TerminalPanel = memo(function TerminalPanel({
  sessionId,
  cwd
}: TerminalPanelProps) {
  return (
    <div className={styles.panel}>
      <XTermWrapper sessionId={sessionId} cwd={cwd} />
    </div>
  )
})
