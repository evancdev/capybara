import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SessionProvider, useSession } from '@/renderer/context/SessionContext'
import type { CapybaraMessage } from '@/shared/types/messages'
import { ErrorProvider } from '@/renderer/context/ErrorContext'

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorProvider>
      <SessionProvider>{children}</SessionProvider>
    </ErrorProvider>
  )
}

function renderSessionHook() {
  return renderHook(() => useSession(), { wrapper: AllProviders })
}

describe('SessionContext', () => {
  it('openProject adds a project and sets activeProjectPath', async () => {
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })

    expect(window.sessionAPI.selectDirectory).toHaveBeenCalled()
    expect(result.current.activeProjectPath).toBe('/test/project')
    expect(result.current.projects.has('/test/project')).toBe(true)

    const project = result.current.projects.get('/test/project')
    expect(project?.name).toBe('project')
    expect(project?.sessions).toEqual([])
  })

  it('createAgent calls window.sessionAPI.createSession, adds session to state, sets activeSessionId', async () => {
    const mockSession = {
      id: 'session-1',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    // First open a project
    await act(async () => {
      await result.current.openProject()
    })

    // Then create an agent
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    expect(window.sessionAPI.createSession).toHaveBeenCalledWith({
      cwd: '/test/project'
    })
    expect(result.current.activeSessionId).toBe('session-1')

    const project = result.current.projects.get('/test/project')
    expect(project?.sessions).toHaveLength(1)
    expect(project?.sessions[0].id).toBe('session-1')
  })

  it('destroyAgent calls window.sessionAPI.destroySession, removes session from state', async () => {
    const mockSession = {
      id: 'session-destroy',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    // Verify session exists
    expect(
      result.current.projects.get('/test/project')?.sessions
    ).toHaveLength(1)

    await act(async () => {
      await result.current.destroyAgent('session-destroy')
    })

    expect(window.sessionAPI.destroySession).toHaveBeenCalledWith(
      'session-destroy'
    )

    const project = result.current.projects.get('/test/project')
    expect(project?.sessions).toHaveLength(0)
  })

  it('closeProject destroys all sessions and removes project', async () => {
    const mockSession = {
      id: 'session-close',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/close-project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)
    // Bypass the window.confirm for running sessions
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/close-project')
    })

    expect(result.current.projects.has('/test/close-project')).toBe(true)

    await act(async () => {
      await result.current.closeProject('/test/close-project')
    })

    expect(window.sessionAPI.destroySession).toHaveBeenCalledWith(
      'session-close'
    )
    expect(result.current.projects.has('/test/close-project')).toBe(false)
    expect(result.current.activeProjectPath).toBeNull()
  })

  it('resumeConversation passes conversationId to createSession', async () => {
    const mockSession = {
      id: 'session-resume',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })

    const conversationId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    await act(async () => {
      await result.current.resumeConversation('/test/project', conversationId)
    })

    expect(window.sessionAPI.createSession).toHaveBeenCalledWith({
      cwd: '/test/project',
      resumeConversationId: conversationId
    })
    expect(result.current.activeSessionId).toBe('session-resume')

    const project = result.current.projects.get('/test/project')
    expect(project?.sessions).toHaveLength(1)
    expect(project?.sessions[0].id).toBe('session-resume')
  })

  it('renameAgent updates sessionNames map locally', async () => {
    const mockSession = {
      id: 'session-rename',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    act(() => {
      result.current.renameAgent('session-rename', 'New Name')
    })

    expect(result.current.sessionNames.get('session-rename')).toBe('New Name')
  })

  it('setSessionPermissionMode calls window.sessionAPI.setPermissionMode', async () => {
    const mockSession = {
      id: 'session-mode',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    await act(async () => {
      await result.current.setSessionPermissionMode('session-mode', 'plan')
    })

    expect(window.sessionAPI.setPermissionMode).toHaveBeenCalledWith(
      'session-mode',
      'plan'
    )
  })

  it('runSessionCommand calls window.sessionAPI.runCommand', async () => {
    const mockSession = {
      id: 'session-cmd',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)
    vi.mocked(window.sessionAPI.runCommand).mockResolvedValue({})

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    await act(async () => {
      await result.current.runSessionCommand('session-cmd', 'compact', [])
    })

    expect(window.sessionAPI.runCommand).toHaveBeenCalledWith(
      'session-cmd',
      'compact',
      []
    )
  })

  it('runSessionCommand switches activeSessionId on newSessionId', async () => {
    const mockSession = {
      id: 'session-cmd-2',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)
    vi.mocked(window.sessionAPI.runCommand).mockResolvedValue({
      newSessionId: 'new-session-from-cmd'
    })

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    await act(async () => {
      await result.current.runSessionCommand('session-cmd-2', 'new', [])
    })

    expect(result.current.activeSessionId).toBe('new-session-from-cmd')
  })

  it('metadata_updated with permissionMode updates the session in the store', async () => {
    const onMessageCallbacks: ((msg: CapybaraMessage) => void)[] = []
    let capturedOnMessage: ((msg: CapybaraMessage) => void) | null = null
    vi.mocked(window.sessionAPI.onMessage).mockImplementation(
      (cb: (msg: CapybaraMessage) => void) => {
        onMessageCallbacks.push(cb)
        capturedOnMessage = (msg) => {
          for (const fn of onMessageCallbacks) fn(msg)
        }
        return () => undefined
      }
    )

    const mockSession = {
      id: 'session-meta',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project')
    })

    // Verify initial mode
    const project = result.current.projects.get('/test/project')
    expect(project?.sessions[0].permissionMode).toBe('default')

    // Simulate the backend emitting a metadata_updated message
    act(() => {
      capturedOnMessage?.({
        kind: 'metadata_updated',
        sessionId: 'session-meta',
        metadata: { permissionMode: 'plan' }
      })
    })

    const updatedProject = result.current.projects.get('/test/project')
    expect(updatedProject?.sessions[0].permissionMode).toBe('plan')
  })

  it('metadata_updated without permissionMode does not change session', async () => {
    const onMessageCallbacks2: ((msg: CapybaraMessage) => void)[] = []
    let capturedOnMessage: ((msg: CapybaraMessage) => void) | null = null
    vi.mocked(window.sessionAPI.onMessage).mockImplementation(
      (cb: (msg: CapybaraMessage) => void) => {
        onMessageCallbacks2.push(cb)
        capturedOnMessage = (msg) => {
          for (const fn of onMessageCallbacks2) fn(msg)
        }
        return () => undefined
      }
    )

    const mockSession = {
      id: 'session-meta-2',
      status: 'running' as const,
      exitCode: null,
      createdAt: Date.now(),
      permissionMode: 'default' as const,
      role: null,
      gitRoot: null,
      gitBranch: null
    }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project2'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project2')
    })

    // Simulate metadata_updated with only model (no permissionMode)
    act(() => {
      capturedOnMessage?.({
        kind: 'metadata_updated',
        sessionId: 'session-meta-2',
        metadata: { model: 'new-model' }
      })
    })

    const project = result.current.projects.get('/test/project2')
    // permissionMode should remain unchanged
    expect(project?.sessions[0].permissionMode).toBe('default')
  })
})
