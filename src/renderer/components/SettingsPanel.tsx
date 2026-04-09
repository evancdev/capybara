import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '@/renderer/context/ThemeContext'
import { useKeyBindings } from '@/renderer/context/KeyBindingsContext'
import { useEscapeKey } from '@/renderer/hooks/useEscapeKey'
import { cx } from '@/renderer/lib/cx'
import { THEME_PRESETS } from '@/renderer/types/theme'
import type {
  KeyBindingsConfig,
  KeyBinding
} from '@/renderer/types/keybindings'
import {
  formatBinding,
  DEFAULT_KEYBINDINGS
} from '@/renderer/types/keybindings'
import styles from '@/renderer/styles/SettingsPanel.module.css'

type SettingsTab = 'appearance' | 'keybindings'

function ShortcutRecorder({
  binding,
  onChange
}: {
  binding: KeyBinding
  onChange: (binding: KeyBinding) => void
}) {
  const [recording, setRecording] = useState(false)
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    if (!recording) return

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()

      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return

      if (!e.metaKey && !e.ctrlKey && e.altKey) {
        setRejected(true)
        setTimeout(() => {
          setRejected(false)
        }, 1500)
        setRecording(false)
        return
      }

      onChange({
        label: binding.label,
        key: e.key.toLowerCase(),
        meta: e.metaKey || e.ctrlKey,
        shift: e.shiftKey
      })
      setRecording(false)
    }

    function handleBlur() {
      setRecording(false)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [recording, binding.label, onChange])

  return (
    <button
      className={cx(styles.shortcutRecorder, recording && styles.recording)}
      onClick={() => {
        setRecording(true)
        setRejected(false)
      }}
    >
      {recording
        ? 'Press keys...'
        : rejected
          ? 'Alt-only not supported'
          : formatBinding(binding)}
    </button>
  )
}

function AppearanceTab() {
  const { activePresetName, setThemePreset } = useTheme()

  return (
    <div className={styles.tabContent}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Theme</span>
        </div>
        <div className={styles.presetGrid}>
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.name}
              className={cx(
                styles.presetCard,
                activePresetName === preset.name && styles.active
              )}
              onClick={() => {
                setThemePreset(preset.name, preset.theme)
              }}
            >
              <div className={styles.presetPreview} aria-hidden="true">
                <div
                  className={styles.presetSwatch}
                  style={{ background: preset.theme.ui.bgPrimary }}
                />
                <div
                  className={styles.presetSwatch}
                  style={{ background: preset.theme.ui.accent }}
                />
                <div
                  className={styles.presetSwatch}
                  style={{ background: preset.theme.ui.success }}
                />
                <div
                  className={styles.presetSwatch}
                  style={{ background: preset.theme.ui.error }}
                />
              </div>
              <span className={styles.presetName}>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function KeybindingsTab() {
  const { bindings, updateBinding, resetBindings } = useKeyBindings()

  const handleChange = useCallback(
    (action: keyof KeyBindingsConfig, binding: KeyBinding) => {
      updateBinding(action, binding)
    },
    [updateBinding]
  )

  return (
    <div className={styles.tabContent}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Keyboard Shortcuts</span>
          <button className={styles.resetBtn} onClick={resetBindings}>
            Reset
          </button>
        </div>
        <div className={styles.keybindingsList}>
          {(
            Object.keys(DEFAULT_KEYBINDINGS) as (keyof KeyBindingsConfig)[]
          ).map((action) => (
            <div key={action} className={styles.keybindingRow}>
              <span className={styles.keybindingLabel}>
                {bindings[action].label}
              </span>
              <ShortcutRecorder
                binding={bindings[action]}
                onChange={(b) => {
                  handleChange(action, b)
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'keybindings', label: 'Keybindings' }
]

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  useEscapeKey(
    useCallback(
      (e: KeyboardEvent) => {
        e.preventDefault()
        onClose()
      },
      [onClose]
    )
  )

  return (
    <div className={styles.panel}>
      <div className={styles.tabBar} role="tablist" aria-label="Settings">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cx(styles.tab, activeTab === tab.id && styles.active)}
            onClick={() => {
              setActiveTab(tab.id)
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className={styles.body}>
        {activeTab === 'appearance' && <AppearanceTab />}
        {activeTab === 'keybindings' && <KeybindingsTab />}
      </div>
    </div>
  )
}
