import type { MouseEvent } from 'react'
import styles from '@/renderer/styles/SplitDivider.module.css'

interface SplitDividerProps {
  onMouseDown: (event: MouseEvent) => void
}

export function SplitDivider({ onMouseDown }: SplitDividerProps) {
  return (
    <div
      className={styles.divider}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  )
}
