import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CYCLING_PERMISSION_MODES,
  permissionModeLabel
} from '@/shared/types/session'
import type { PermissionMode } from '@/shared/types/session'
import { useSession } from '@/renderer/context/SessionContext'
import styles from '@/renderer/styles/ModeSelector.module.css'

export interface ModeSelectorProps {
  sessionId: string
  currentMode: PermissionMode
}

export function ModeSelector({ sessionId, currentMode }: ModeSelectorProps) {
  const { setSessionPermissionMode } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleSelect = useCallback(
    (mode: PermissionMode) => {
      setOpen(false)
      if (mode === currentMode) return
      void setSessionPermissionMode(sessionId, mode)
    },
    [sessionId, currentMode, setSessionPermissionMode]
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

  const currentLabel = permissionModeLabel(currentMode)

  return (
    <div
      className={styles.container}
      ref={containerRef}
      title="Permission mode (Shift+Tab to cycle)"
    >
      <button
        className={`${styles.pill} ${styles[`pill_${currentLabel}`] ?? ''}`}
        onClick={() => {
          setOpen((prev) => !prev)
        }}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Permission mode: ${currentLabel}`}
      >
        {currentLabel}
      </button>
      {open ? (
        <ul className={styles.dropdown} role="listbox" aria-label="Permission mode">
          {CYCLING_PERMISSION_MODES.map((mode) => {
            const label = permissionModeLabel(mode)
            const active = mode === currentMode
            return (
              <li
                key={mode}
                role="option"
                aria-selected={active}
                className={`${styles.option} ${active ? styles.optionActive : ''}`}
                onClick={() => {
                  handleSelect(mode)
                }}
              >
                {label}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
