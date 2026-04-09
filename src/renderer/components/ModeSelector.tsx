import { useCallback } from 'react'
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

  const handleSelect = useCallback(
    (mode: PermissionMode) => {
      if (mode === currentMode) return
      void setSessionPermissionMode(sessionId, mode)
    },
    [sessionId, currentMode, setSessionPermissionMode]
  )

  const isCyclingMode = (CYCLING_PERMISSION_MODES as readonly string[]).includes(currentMode)

  return (
    <div
      className={styles.selector}
      role="radiogroup"
      aria-label={
        isCyclingMode
          ? 'Permission mode'
          : `Permission mode (current: ${permissionModeLabel(currentMode)})`
      }
      title="Permission mode (Shift+Tab to cycle)"
    >
      {CYCLING_PERMISSION_MODES.map((mode) => {
        const label = permissionModeLabel(mode)
        const active = mode === currentMode
        return (
          <button
            key={mode}
            role="radio"
            aria-checked={active}
            className={`${styles.segment} ${active ? styles[`active_${label}`] : ''}`}
            onClick={() => {
              handleSelect(mode)
            }}
            type="button"
          >
            {label}
          </button>
        )
      })}
      {!isCyclingMode && (
        <span className="sr-only" role="status">
          Active mode: {permissionModeLabel(currentMode)}
        </span>
      )}
    </div>
  )
}
