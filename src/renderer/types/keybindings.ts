export interface KeyBinding {
  label: string
  key: string
  meta: boolean
  shift: boolean
}

export interface KeyBindingsConfig {
  newAgent: KeyBinding
  closeAgent: KeyBinding
  newProject: KeyBinding
  closeProject: KeyBinding
  toggleSettings: KeyBinding
  cycleMode: KeyBinding
}

export const DEFAULT_KEYBINDINGS: KeyBindingsConfig = {
  newAgent: { label: 'New Agent', key: 't', meta: true, shift: false },
  closeAgent: { label: 'Close Agent', key: 'w', meta: true, shift: false },
  newProject: { label: 'New Project', key: 'n', meta: true, shift: false },
  closeProject: { label: 'Close Project', key: 'w', meta: true, shift: true },
  toggleSettings: {
    label: 'Toggle Settings',
    key: ',',
    meta: true,
    shift: false
  },
  cycleMode: {
    label: 'Cycle permission mode',
    key: 'Tab',
    meta: false,
    shift: true
  }
}

export function formatBinding(binding: KeyBinding): string {
  const parts: string[] = []
  if (binding.meta)
    parts.push(navigator.userAgent.includes('Mac') ? 'Cmd' : 'Ctrl')
  if (binding.shift) parts.push('Shift')
  const keyDisplay =
    binding.key === ','
      ? ','
      : binding.key === ' '
        ? 'Space'
        : binding.key.toUpperCase()
  parts.push(keyDisplay)
  return parts.join(' + ')
}

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  const meta = e.metaKey || e.ctrlKey
  if (binding.meta && !meta) return false
  if (!binding.meta && meta) return false
  if (binding.shift !== e.shiftKey) return false
  return e.key.toLowerCase() === binding.key.toLowerCase()
}
