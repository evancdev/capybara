import { describe, it, expect } from 'vitest'
import {
  matchesBinding,
  formatBinding,
  DEFAULT_KEYBINDINGS
} from '@/renderer/types/keybindings'
import type { KeyBinding } from '@/renderer/types/keybindings'

// ---------------------------------------------------------------------------
// matchesBinding
// ---------------------------------------------------------------------------
describe('matchesBinding', () => {
  function makeEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key: '',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...overrides
    } as KeyboardEvent
  }

  it('matches Shift+Tab for the cycleMode binding', () => {
    const e = makeEvent({ key: 'Tab', shiftKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.cycleMode)).toBe(true)
  })

  it('does not match plain Tab for cycleMode', () => {
    const e = makeEvent({ key: 'Tab', shiftKey: false })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.cycleMode)).toBe(false)
  })

  it('does not match Shift+Tab+Meta for cycleMode (meta=false binding)', () => {
    const e = makeEvent({ key: 'Tab', shiftKey: true, metaKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.cycleMode)).toBe(false)
  })

  it('does not match Shift+Tab+Ctrl for cycleMode', () => {
    const e = makeEvent({ key: 'Tab', shiftKey: true, ctrlKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.cycleMode)).toBe(false)
  })

  it('matches Cmd+T for newAgent', () => {
    const e = makeEvent({ key: 't', metaKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.newAgent)).toBe(true)
  })

  it('matches Ctrl+T for newAgent (ctrlKey counts as meta)', () => {
    const e = makeEvent({ key: 't', ctrlKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.newAgent)).toBe(true)
  })

  it('key matching is case-insensitive', () => {
    const e = makeEvent({ key: 'T', metaKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.newAgent)).toBe(true)
  })

  it('does not match wrong key', () => {
    const e = makeEvent({ key: 'x', shiftKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.cycleMode)).toBe(false)
  })

  it('matches Cmd+Shift+W for closeProject', () => {
    const e = makeEvent({ key: 'w', metaKey: true, shiftKey: true })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.closeProject)).toBe(true)
  })

  it('does not match Cmd+W (no shift) for closeProject', () => {
    const e = makeEvent({ key: 'w', metaKey: true, shiftKey: false })
    expect(matchesBinding(e, DEFAULT_KEYBINDINGS.closeProject)).toBe(false)
  })

  it('rejects when binding requires meta but neither metaKey nor ctrlKey is pressed', () => {
    const binding: KeyBinding = {
      label: 'test',
      key: 'a',
      meta: true,
      shift: false
    }
    const e = makeEvent({ key: 'a' })
    expect(matchesBinding(e, binding)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatBinding
// ---------------------------------------------------------------------------
describe('formatBinding', () => {
  it('formats Shift+Tab (no meta key, so no navigator access)', () => {
    const result = formatBinding(DEFAULT_KEYBINDINGS.cycleMode)
    expect(result).toBe('Shift + TAB')
  })
})

// ---------------------------------------------------------------------------
// DEFAULT_KEYBINDINGS completeness
// ---------------------------------------------------------------------------
describe('DEFAULT_KEYBINDINGS', () => {
  it('has a cycleMode binding for Shift+Tab', () => {
    expect(DEFAULT_KEYBINDINGS.cycleMode).toEqual({
      label: 'Cycle permission mode',
      key: 'Tab',
      meta: false,
      shift: true
    })
  })

  it('has all expected bindings', () => {
    const expectedKeys = [
      'newAgent',
      'closeAgent',
      'newProject',
      'closeProject',
      'toggleSettings',
      'cycleMode'
    ]
    for (const key of expectedKeys) {
      expect(DEFAULT_KEYBINDINGS).toHaveProperty(key)
    }
  })
})
