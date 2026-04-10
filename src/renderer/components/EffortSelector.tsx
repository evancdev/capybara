import { useCallback, useEffect, useRef, useState } from 'react'
import { CYCLING_EFFORT_LEVELS } from '@/shared/types/session'
import type { EffortLevel } from '@/shared/types/session'
import { useSession } from '@/renderer/context/SessionContext'
import styles from '@/renderer/styles/EffortSelector.module.css'

export interface EffortSelectorProps {
  sessionId: string
  currentEffort: EffortLevel
}

const EFFORT_PILL_CLASS: Record<EffortLevel, string> = {
  auto: 'pill_auto',
  low: 'pill_low',
  medium: 'pill_medium',
  high: 'pill_high',
  max: 'pill_max'
}

export function EffortSelector({
  sessionId,
  currentEffort
}: EffortSelectorProps) {
  const { runSessionCommand } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleSelect = useCallback(
    (level: EffortLevel) => {
      setOpen(false)
      if (level === currentEffort) return
      void runSessionCommand(sessionId, 'effort', [level])
    },
    [sessionId, currentEffort, runSessionCommand]
  )

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div
      className={styles.container}
      ref={containerRef}
      title="Reasoning effort level"
    >
      <button
        className={`${styles.pill} ${styles[EFFORT_PILL_CLASS[currentEffort]] ?? ''}`}
        onClick={() => {
          setOpen((prev) => !prev)
        }}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Effort level: ${currentEffort}`}
      >
        effort: {currentEffort}
      </button>
      {open ? (
        <ul
          className={styles.dropdown}
          role="listbox"
          aria-label="Effort level"
        >
          {CYCLING_EFFORT_LEVELS.map((level) => {
            const active = level === currentEffort
            return (
              <li
                key={level}
                role="option"
                aria-selected={active}
                className={`${styles.option} ${active ? styles.optionActive : ''}`}
                onClick={() => {
                  handleSelect(level)
                }}
              >
                {level}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
