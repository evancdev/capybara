import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { ConversationHistory } from '@/renderer/components/ConversationHistory'
import { ErrorProvider, useError } from '@/renderer/context/ErrorContext'

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
})
