import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Session } from '@/shared/types/session'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

const setSessionPermissionModeMock = vi.fn().mockResolvedValue(undefined)
const createAgentMock = vi.fn().mockResolvedValue(undefined)
const destroyAgentMock = vi.fn().mockResolvedValue(undefined)
const openProjectMock = vi.fn().mockResolvedValue(undefined)
const closeProjectMock = vi.fn().mockResolvedValue(undefined)
const setActiveSessionMock = vi.fn()

function makeSession(
  id: string,
  permissionMode: Session['permissionMode'] = 'default'
): Session {
  return {
    id,
    status: 'running',
    exitCode: null,
    createdAt: 0,
    permissionMode,
    effortLevel: 'high',
    role: null,
    gitRoot: null,
    gitBranch: null
  }
}

let mockSessionState: {
  projects: Map<string, { path: string; name: string; sessions: Session[] }>
  activeProjectPath: string | null
  activeSessionId: string | null
}

vi.mock('@/renderer/context/SessionContext', () => ({
  useSession: () => ({
    ...mockSessionState,
    createAgent: createAgentMock,
    destroyAgent: destroyAgentMock,
    openProject: openProjectMock,
    closeProject: closeProjectMock,
    setActiveSession: setActiveSessionMock,
    setSessionPermissionMode: setSessionPermissionModeMock
  })
}))

vi.mock('@/renderer/context/KeyBindingsContext', async () => {
  const { DEFAULT_KEYBINDINGS } = await import('@/renderer/types/keybindings')
  return { useKeyBindings: () => ({ bindings: DEFAULT_KEYBINDINGS }) }
})

import { useKeyboardShortcuts } from '@/renderer/hooks/useKeyboardShortcuts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shiftTabEvent(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Tab',
    code: 'Tab',
    shiftKey: true,
    bubbles: true,
    cancelable: true
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts — cycleMode (Shift+Tab)', () => {
  const onToggleSettings = vi.fn()

  beforeEach(() => {
    setSessionPermissionModeMock.mockReset()
    setSessionPermissionModeMock.mockResolvedValue(undefined)
    onToggleSettings.mockReset()
  })

  function setup(
    permissionMode: Session['permissionMode'] = 'default',
    activeSessionId: string | null = 'sid-1'
  ) {
    const session = makeSession('sid-1', permissionMode)
    mockSessionState = {
      projects: new Map([
        ['/test', { path: '/test', name: 'test', sessions: [session] }]
      ]),
      activeProjectPath: '/test',
      activeSessionId
    }
    renderHook(() => useKeyboardShortcuts(onToggleSettings))
  }

  it('cycles default -> plan on Shift+Tab', () => {
    setup('default')
    const event = shiftTabEvent()
    document.dispatchEvent(event)
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith('sid-1', 'plan')
    expect(event.defaultPrevented).toBe(true)
  })

  it('cycles plan -> acceptEdits', () => {
    setup('plan')
    const event = shiftTabEvent()
    document.dispatchEvent(event)
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'sid-1',
      'acceptEdits'
    )
  })

  it('cycles acceptEdits -> default', () => {
    setup('acceptEdits')
    const event = shiftTabEvent()
    document.dispatchEvent(event)
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'sid-1',
      'default'
    )
  })

  it('falls back to default from bypassPermissions (non-cycling mode)', () => {
    setup('bypassPermissions')
    const event = shiftTabEvent()
    document.dispatchEvent(event)
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'sid-1',
      'default'
    )
  })

  it('does not fire when no session is active', () => {
    setup('default', null)
    const event = shiftTabEvent()
    document.dispatchEvent(event)
    expect(setSessionPermissionModeMock).not.toHaveBeenCalled()
    // Should NOT preventDefault — let browser handle it
    expect(event.defaultPrevented).toBe(false)
  })

  it('preventDefault stops browser reverse-focus-navigation', () => {
    setup('default')
    const event = shiftTabEvent()
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
