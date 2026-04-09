import { describe, it, expect } from 'vitest'
import {
  CYCLING_PERMISSION_MODES,
  DEFAULT_PERMISSION_MODE,
  permissionModeLabel
} from '@/shared/types/session'
import type { PermissionMode } from '@/shared/types/session'

// ---------------------------------------------------------------------------
// DEFAULT_PERMISSION_MODE
// ---------------------------------------------------------------------------
describe('DEFAULT_PERMISSION_MODE', () => {
  it('is "default"', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('default')
  })
})

// ---------------------------------------------------------------------------
// CYCLING_PERMISSION_MODES
// ---------------------------------------------------------------------------
describe('CYCLING_PERMISSION_MODES', () => {
  it('contains exactly 3 modes in the documented order', () => {
    expect(CYCLING_PERMISSION_MODES).toEqual([
      'default',
      'plan',
      'acceptEdits'
    ])
  })

  it('does not contain bypassPermissions', () => {
    expect(CYCLING_PERMISSION_MODES).not.toContain('bypassPermissions')
  })

  it('does not contain dontAsk', () => {
    expect(CYCLING_PERMISSION_MODES).not.toContain('dontAsk')
  })
})

// ---------------------------------------------------------------------------
// permissionModeLabel
// ---------------------------------------------------------------------------
describe('permissionModeLabel', () => {
  it.each<[PermissionMode, string]>([
    ['default', 'approve'],
    ['plan', 'plan'],
    ['acceptEdits', 'auto'],
    ['bypassPermissions', 'bypass'],
    ['dontAsk', 'dontask']
  ])('maps %s to "%s"', (mode, expected) => {
    expect(permissionModeLabel(mode)).toBe(expected)
  })

  it('returns a label for every mode in CYCLING_PERMISSION_MODES', () => {
    for (const mode of CYCLING_PERMISSION_MODES) {
      expect(permissionModeLabel(mode)).toBeDefined()
    }
  })
})
