import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SessionProvider, useSession } from '@/renderer/context/SessionContext'
import { ErrorProvider } from '@/renderer/context/ErrorContext'
import { TerminalDispatchProvider } from '@/renderer/context/TerminalDispatchContext'

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorProvider>
      <TerminalDispatchProvider>
        <SessionProvider>{children}</SessionProvider>
      </TerminalDispatchProvider>
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
      pid: 1234,
      status: 'running' as const,
      exitCode: null,
      command: 'claude',
      cwd: '/test/project',
      name: 'Agent 1',
      createdAt: Date.now()
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
      await result.current.createAgent('/test/project', 'Agent 1')
    })

    expect(window.sessionAPI.createSession).toHaveBeenCalledWith({
      cwd: '/test/project',
      name: 'Agent 1'
    })
    expect(result.current.activeSessionId).toBe('session-1')

    const project = result.current.projects.get('/test/project')
    expect(project?.sessions).toHaveLength(1)
    expect(project?.sessions[0].id).toBe('session-1')
  })

  it('destroyAgent calls window.sessionAPI.destroySession, removes session from state', async () => {
    const mockSession = {
      id: 'session-destroy',
      pid: 5678,
      status: 'running' as const,
      exitCode: null,
      command: 'claude',
      cwd: '/test/project',
      name: 'Agent to destroy',
      createdAt: Date.now()
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
      pid: 9999,
      status: 'running' as const,
      exitCode: null,
      command: 'claude',
      cwd: '/test/close-project',
      name: 'Agent',
      createdAt: Date.now()
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

  it('renameAgent calls window.sessionAPI.renameSession, updates session name in state', async () => {
    const mockSession = {
      id: 'session-rename',
      pid: 4321,
      status: 'running' as const,
      exitCode: null,
      command: 'claude',
      cwd: '/test/project',
      name: 'Original Name',
      createdAt: Date.now()
    }
    const renamedSession = { ...mockSession, name: 'New Name' }
    vi.mocked(window.sessionAPI.selectDirectory).mockResolvedValue(
      '/test/project'
    )
    vi.mocked(window.sessionAPI.createSession).mockResolvedValue(mockSession)
    vi.mocked(window.sessionAPI.renameSession).mockResolvedValue(renamedSession)

    const { result } = renderSessionHook()

    await act(async () => {
      await result.current.openProject()
    })
    await act(async () => {
      await result.current.createAgent('/test/project', 'Original Name')
    })

    await act(async () => {
      await result.current.renameAgent('session-rename', 'New Name')
    })

    expect(window.sessionAPI.renameSession).toHaveBeenCalledWith(
      'session-rename',
      'New Name'
    )

    const project = result.current.projects.get('/test/project')
    expect(project?.sessions[0].name).toBe('New Name')
  })
})
