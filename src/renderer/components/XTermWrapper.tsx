import { useRef } from 'react'
import { useTerminal } from '@/renderer/hooks/useTerminal'
import styles from '@/renderer/styles/XTermWrapper.module.css'

interface XTermWrapperProps {
  sessionId: string
  cwd: string
}

export function XTermWrapper({ sessionId, cwd }: XTermWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminal(sessionId, containerRef, cwd)

  return <div className={styles.xtermWrapper} ref={containerRef} />
}
