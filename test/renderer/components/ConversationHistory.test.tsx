import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { Session } from '@/shared/types/session'
import { ConversationHistory } from '@/renderer/components/ConversationHistory'
import { ErrorProvider, useError } from '@/renderer/context/ErrorContext'

function makeConversation(overrides: Partial<Session> = {}): Session {
  return {
    id: 'conv-1',
    status: 'exited',
    exitCode: 0,
    createdAt: Date.now() - 10_000,
    lastActive: Date.now() - 10_000,
    title: 'Original Title',
    role: null,
    gitRoot: null,
    gitBranch: null,
    ...overrides
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

function Wrapper({ children }: { children: ReactNode }) {
  return <ErrorProvider>{children}</ErrorProvider>
}

/** Helper component that exposes the last error from ErrorContext for assertions. */
function ErrorSpy({ onError }: { onError: (msg: string | null) => void }) {
  const { lastError } = useError()
  onError(lastError)
  return null
}

describe('ConversationHistory', () => {
  it('renders without crashing', () => {
    render(
      <Wrapper>
        <ConversationHistory
          projectPath="/test/project"
          onResume={vi.fn()}
        />
      </Wrapper>
    )

    expect(
      screen.getByRole('button', { name: /recent conversations/i })
    ).toBeInTheDocument()
  })

  it('when expanded, calls window.sessionAPI.listConversations', async () => {
    const user = userEvent.setup()

    vi.mocked(window.sessionAPI.listConversations).mockResolvedValue([])

    render(
      <Wrapper>
        <ConversationHistory
          projectPath="/test/project"
          onResume={vi.fn()}
        />
      </Wrapper>
    )

    const toggle = screen.getByRole('button', {
      name: /recent conversations/i
    })

    await user.click(toggle)

    expect(window.sessionAPI.listConversations).toHaveBeenCalledWith(
      '/test/project'
    )
  })

  it('when IPC call fails, calls setError (B5 fix)', async () => {
    const user = userEvent.setup()
    let capturedError: string | null = null

    vi.mocked(window.sessionAPI.listConversations).mockRejectedValue(
      new Error('IPC failure')
    )

    render(
      <Wrapper>
        <ErrorSpy onError={(msg) => { capturedError = msg }} />
        <ConversationHistory
          projectPath="/test/project"
          onResume={vi.fn()}
        />
      </Wrapper>
    )

    const toggle = screen.getByRole('button', {
      name: /recent conversations/i
    })

    await user.click(toggle)

    // Wait for the async error to propagate
    await act(async () => {
      await vi.waitFor(() => {
        expect(capturedError).toBe('IPC failure')
      })
    })
  })

  describe('rename', () => {
    async function openAndStartRename(projectPath = '/test/project') {
      const user = userEvent.setup()
      vi.mocked(window.sessionAPI.listConversations).mockResolvedValue([
        makeConversation()
      ])

      const utils = render(
        <Wrapper>
          <ConversationHistory
            projectPath={projectPath}
            onResume={vi.fn()}
          />
        </Wrapper>
      )

      await user.click(
        screen.getByRole('button', { name: /recent conversations/i })
      )

      await vi.waitFor(() => {
        expect(screen.getByText('Original Title')).toBeInTheDocument()
      })

      await user.click(
        screen.getByRole('button', { name: /rename conversation/i })
      )

      const input = await screen.findByDisplayValue('Original Title')
      return { user, input, ...utils }
    }

    it('rename success updates the row and calls the IPC bridge', async () => {
      vi.mocked(window.sessionAPI.renameConversation).mockResolvedValue(
        undefined
      )

      const { user, input } = await openAndStartRename()

      await user.clear(input)
      await user.type(input, 'Renamed Title{Enter}')

      await vi.waitFor(() => {
        expect(window.sessionAPI.renameConversation).toHaveBeenCalledWith({
          conversationId: 'conv-1',
          title: 'Renamed Title',
          cwd: '/test/project'
        })
      })

      // New title renders without a refetch.
      expect(screen.getByText('Renamed Title')).toBeInTheDocument()
      expect(screen.queryByText('Original Title')).not.toBeInTheDocument()
      expect(window.sessionAPI.listConversations).toHaveBeenCalledTimes(1)
    })

    it('rename failure reverts the title and surfaces the error', async () => {
      vi.mocked(window.sessionAPI.renameConversation).mockRejectedValue(
        new Error('disk full')
      )

      let capturedError: string | null = null
      const user = userEvent.setup()
      vi.mocked(window.sessionAPI.listConversations).mockResolvedValue([
        makeConversation()
      ])

      render(
        <Wrapper>
          <ErrorSpy onError={(msg) => { capturedError = msg }} />
          <ConversationHistory
            projectPath="/test/project"
            onResume={vi.fn()}
          />
        </Wrapper>
      )

      await user.click(
        screen.getByRole('button', { name: /recent conversations/i })
      )
      await vi.waitFor(() => {
        expect(screen.getByText('Original Title')).toBeInTheDocument()
      })
      await user.click(
        screen.getByRole('button', { name: /rename conversation/i })
      )
      const input = await screen.findByDisplayValue('Original Title')
      await user.clear(input)
      await user.type(input, 'Bad Title{Enter}')

      await act(async () => {
        await vi.waitFor(() => {
          expect(capturedError).toBe('disk full')
        })
      })

      // Title reverts back to original.
      await vi.waitFor(() => {
        expect(screen.getByText('Original Title')).toBeInTheDocument()
      })
      expect(screen.queryByText('Bad Title')).not.toBeInTheDocument()
    })

    it('whitespace-only title does not call the rename API', async () => {
      const { user, input } = await openAndStartRename()

      await user.clear(input)
      await user.type(input, '   {Enter}')

      // InlineRenameInput swallows whitespace-only commits; exit rename mode.
      await vi.waitFor(() => {
        expect(
          screen.queryByDisplayValue(/\s+/)
        ).not.toBeInTheDocument()
      })
      expect(window.sessionAPI.renameConversation).not.toHaveBeenCalled()
      // Original title remains.
      const list = screen.getByText('Original Title')
      expect(list).toBeInTheDocument()
    })
  })
})
