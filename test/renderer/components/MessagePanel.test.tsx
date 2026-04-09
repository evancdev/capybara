import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessagePanel } from '@/renderer/components/MessagePanel'
import type { CapybaraMessage } from '@/shared/types/messages'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createTextDelta(
  text: string,
  sessionId = 'sid-1'
): CapybaraMessage {
  return {
    kind: 'assistant_text_delta',
    sessionId,
    text
  }
}

function createUserMessage(
  text: string,
  sessionId = 'sid-1'
): CapybaraMessage {
  return {
    kind: 'user_message',
    sessionId,
    text,
    timestamp: Date.now()
  }
}

function createToolResult(
  toolUseId: string,
  output: string,
  sessionId = 'sid-1'
): CapybaraMessage {
  return {
    kind: 'tool_result',
    sessionId,
    toolUseId,
    output,
    isError: false
  }
}

function createToolUseRequest(
  toolName: string,
  toolUseId: string,
  sessionId = 'sid-1'
): CapybaraMessage {
  return {
    kind: 'tool_use_request',
    sessionId,
    toolUseId,
    toolName,
    input: { file_path: 'test.ts' },
    requiresApproval: false
  }
}

function createUsageMessage(sessionId = 'sid-1'): CapybaraMessage {
  return {
    kind: 'usage_message',
    sessionId,
    turnUsage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: null,
      cacheCreationTokens: null
    },
    summary: {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCostUsd: null,
      turnCount: 1
    }
  }
}

function createSystemMessage(
  model = 'claude-sonnet-4-20250514',
  sessionId = 'sid-1'
): CapybaraMessage {
  return {
    kind: 'system_message',
    sessionId,
    messageType: 'init',
    text: JSON.stringify({ model, tools: ['Read'] })
  }
}

function createErrorMessage(
  message: string,
  sessionId = 'sid-1'
): CapybaraMessage {
  return {
    kind: 'error_message',
    sessionId,
    code: 'unknown',
    message,
    recoverable: false
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MessagePanel', () => {
  describe('empty state (startup animation)', () => {
    it('renders startup animation when no messages', () => {
      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={vi.fn().mockResolvedValue(undefined)}
        />
      )

      // The startup animation should be visible with an aria-label
      expect(
        screen.getByLabelText('Initializing session')
      ).toBeInTheDocument()
    })

    it('renders scroll container but no message list when empty', () => {
      const { container } = render(<MessagePanel sessionId="sid-1" messages={[]} />)

      // Scroll container is always present (banner lives inside it)
      expect(screen.getByRole('log')).toBeInTheDocument()

      // But the messages list should not be rendered
      expect(
        container.querySelector(`.messagesList`)
      ).not.toBeInTheDocument()
    })
  })

  describe('message rendering', () => {
    it('renders a single message', () => {
      const messages: CapybaraMessage[] = [
        createTextDelta('Hello world')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(screen.getByText('Hello world')).toBeInTheDocument()
    })

    it('renders multiple messages in order', () => {
      const messages: CapybaraMessage[] = [
        createSystemMessage(),
        createTextDelta('First response'),
        createTextDelta('Second response')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      // init messages are hidden in terminal aesthetic
      expect(screen.getByText('First response')).toBeInTheDocument()
      expect(screen.getByText('Second response')).toBeInTheDocument()
    })

    it('renders mixed message types', () => {
      const messages: CapybaraMessage[] = [
        createSystemMessage(),
        createTextDelta('Response text'),
        createErrorMessage('Something went wrong')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(screen.getByText('Response text')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
  })

  describe('scroll container', () => {
    it('renders a scroll container with role="log"', () => {
      const messages: CapybaraMessage[] = [createTextDelta('msg')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(screen.getByRole('log')).toBeInTheDocument()
    })

    it('has aria-live="polite" for accessibility', () => {
      const messages: CapybaraMessage[] = [createTextDelta('msg')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const log = screen.getByRole('log')
      expect(log).toHaveAttribute('aria-live', 'polite')
    })

    it('has aria-label for accessibility', () => {
      const messages: CapybaraMessage[] = [createTextDelta('msg')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const log = screen.getByRole('log')
      expect(log).toHaveAttribute('aria-label', 'Session messages')
    })
  })

  describe('data-session-id attribute', () => {
    it('sets data-session-id on the panel', () => {
      const messages: CapybaraMessage[] = [createTextDelta('msg')]

      const { container } = render(
        <MessagePanel sessionId="test-session-123" messages={messages} />
      )

      const panel = container.querySelector('[data-session-id="test-session-123"]')
      expect(panel).not.toBeNull()
    })
  })

  describe('scroll-to-bottom button', () => {
    it('does not show scroll indicator by default', () => {
      const messages: CapybaraMessage[] = [createTextDelta('msg')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByText('Scroll to see new messages')
      ).not.toBeInTheDocument()
    })
  })

  describe('terminal prompt', () => {
    it('does not render prompt when onSendMessage is not provided', () => {
      render(<MessagePanel sessionId="sid-1" messages={[]} />)

      expect(
        screen.queryByLabelText('Message input')
      ).not.toBeInTheDocument()
    })

    it('renders prompt when onSendMessage is provided', () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      expect(screen.getByLabelText('Message input')).toBeInTheDocument()
    })

    it('does not render a Send button (terminal prompt style)', () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      // Terminal prompt has no Send button — Enter submits
      expect(screen.queryByLabelText('Send message')).not.toBeInTheDocument()
    })

    it('renders prompt below messages when messages exist', () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined)
      const messages: CapybaraMessage[] = [createTextDelta('Hello')]

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={messages}
          onSendMessage={sendMessage}
        />
      )

      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.getByLabelText('Message input')).toBeInTheDocument()
    })

    it('has placeholder text on the input', () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('calls onSendMessage with sessionId and text on Enter', async () => {
      const user = userEvent.setup()
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      const input = screen.getByLabelText('Message input')
      await user.type(input, 'Hello Claude')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(sendMessage).toHaveBeenCalledWith('sid-1', 'Hello Claude')
      })
    })

    it('clears the input after successful send', async () => {
      const user = userEvent.setup()
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      const input = screen.getByLabelText<HTMLTextAreaElement>('Message input')
      await user.type(input, 'Hello Claude')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(input.value).toBe('')
      })
    })

    it('does not send on Shift+Enter (allows newline)', async () => {
      const user = userEvent.setup()
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      const input = screen.getByLabelText('Message input')
      await user.type(input, 'line one')
      await user.keyboard('{Shift>}{Enter}{/Shift}')
      await user.type(input, 'line two')

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('does not send whitespace-only input', async () => {
      const user = userEvent.setup()
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      const input = screen.getByLabelText('Message input')
      await user.type(input, '   ')
      await user.keyboard('{Enter}')

      expect(sendMessage).not.toHaveBeenCalled()
    })

    it('disables input while sending', async () => {
      let resolvePromise: () => void
      const sendMessage = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePromise = resolve
          })
      )

      const user = userEvent.setup()

      render(
        <MessagePanel
          sessionId="sid-1"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      const input = screen.getByLabelText('Message input')
      await user.type(input, 'Slow message')
      await user.keyboard('{Enter}')

      // While the promise is pending, input should be disabled
      await waitFor(() => {
        expect(input).toBeDisabled()
      })

      // Resolve the promise — input should re-enable
      resolvePromise!()

      await waitFor(() => {
        expect(input).not.toBeDisabled()
      })
    })

    it('sets data-session-id on the panel in empty state', () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined)

      const { container } = render(
        <MessagePanel
          sessionId="test-session-abc"
          messages={[]}
          onSendMessage={sendMessage}
        />
      )

      const panel = container.querySelector('[data-session-id="test-session-abc"]')
      expect(panel).not.toBeNull()
    })
  })

  describe('thinking indicator', () => {
    it('shows spinner after a user_message (waiting for assistant)', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.getByLabelText('Assistant is thinking')
      ).toBeInTheDocument()
    })

    it('shows spinner after a tool_result (waiting for assistant to process)', () => {
      const messages: CapybaraMessage[] = [
        createTextDelta('Let me read that file.'),
        createToolUseRequest('Read', 'tu-1'),
        createToolResult('tu-1', 'file contents here')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.getByLabelText('Assistant is thinking')
      ).toBeInTheDocument()
    })

    it('does not show spinner after assistant_text_delta', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createTextDelta('Hi there!')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('does not show spinner after assistant_message', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('does not show spinner when messages list is empty', () => {
      render(<MessagePanel sessionId="sid-1" messages={[]} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('does not show spinner after error_message', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createErrorMessage('Something went wrong')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('shows spinner when trailing invisible messages follow user_message', () => {
      // usage_message and metadata_updated are invisible — the spinner should
      // still appear because the last *visible* message is user_message
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createUsageMessage()
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.getByLabelText('Assistant is thinking')
      ).toBeInTheDocument()
    })

    it('shows spinner when trailing init system_message follows tool_result', () => {
      const messages: CapybaraMessage[] = [
        createToolResult('tu-1', 'output'),
        createSystemMessage() // init — invisible
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.getByLabelText('Assistant is thinking')
      ).toBeInTheDocument()
    })

    it('disappears when assistant_text_delta arrives after user_message', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello')
      ]

      const { rerender } = render(
        <MessagePanel sessionId="sid-1" messages={messages} />
      )

      expect(
        screen.getByLabelText('Assistant is thinking')
      ).toBeInTheDocument()

      // Simulate assistant response arriving
      const updatedMessages: CapybaraMessage[] = [
        ...messages,
        createTextDelta('Hi!')
      ]

      rerender(
        <MessagePanel sessionId="sid-1" messages={updatedMessages} />
      )

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('cycles through spinner characters over time', () => {
      vi.useFakeTimers()

      const messages: CapybaraMessage[] = [
        createUserMessage('Hello')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const indicator = screen.getByLabelText('Assistant is thinking')
      const initialChar = indicator.textContent

      // Advance past one spinner interval (300ms)
      act(() => {
        vi.advanceTimersByTime(300)
      })

      const nextChar = indicator.textContent

      // The character should have changed
      expect(nextChar).not.toBe(initialChar)

      vi.useRealTimers()
    })

    it('has role="status" for accessibility', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const indicator = screen.getByLabelText('Assistant is thinking')
      expect(indicator).toHaveAttribute('role', 'status')
    })

    it('does not show spinner after thinking_delta (assistant is active)', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        {
          kind: 'thinking_delta',
          sessionId: 'sid-1',
          text: 'Let me think...'
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('does not show spinner after tool_progress (tool is running)', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createTextDelta('Reading file...'),
        createToolUseRequest('Read', 'tu-1'),
        {
          kind: 'tool_progress',
          sessionId: 'sid-1',
          toolName: 'Read',
          toolUseId: 'tu-1',
          elapsedSeconds: 2
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('does not show spinner after task_update', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Analyze this'),
        {
          kind: 'task_update',
          sessionId: 'sid-1',
          taskId: 'task-1',
          status: 'started',
          description: 'Analyzing code'
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(
        screen.queryByLabelText('Assistant is thinking')
      ).not.toBeInTheDocument()
    })

    it('skips invisible tool_use_summary when checking thinking state', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createTextDelta('Done.'),
        createToolUseRequest('Read', 'tu-1'),
        createToolResult('tu-1', 'contents'),
        {
          kind: 'tool_use_summary',
          sessionId: 'sid-1',
          summary: 'Read 10 lines from file.ts'
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      // tool_use_summary is skipped; last visible is tool_result -> thinking
      expect(
        screen.getByLabelText('Assistant is thinking')
      ).toBeInTheDocument()
    })
  })

  describe('elapsed timer', () => {
    it('does not show timer when messages list is empty', () => {
      render(<MessagePanel sessionId="sid-1" messages={[]} />)

      expect(
        screen.queryByLabelText('Elapsed time')
      ).not.toBeInTheDocument()
    })

    it('does not show timer immediately after user_message (waits 1s)', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('Hello')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      // Timer should not be visible yet (0s is hidden, no tokens yet)
      expect(
        screen.queryByLabelText('Elapsed time')
      ).not.toBeInTheDocument()

      vi.useRealTimers()
    })

    it('shows timer after 1 second when agent is running', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('Hello')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      const timer = screen.getByLabelText('Elapsed time')
      expect(timer).toBeInTheDocument()
      expect(timer.textContent).toBe('1s')

      vi.useRealTimers()
    })

    it('increments the timer every second', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('Hello')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      const timer = screen.getByLabelText('Elapsed time')
      expect(timer.textContent).toBe('5s')

      vi.useRealTimers()
    })

    it('formats minutes correctly at 60s', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('Hello')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(83_000) // 1m 23s
      })

      const timer = screen.getByLabelText('Elapsed time')
      expect(timer.textContent).toBe('1m 23s')

      vi.useRealTimers()
    })

    it('zero-pads seconds in minutes format', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('Hello')]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(125_000) // 2m 05s
      })

      const timer = screen.getByLabelText('Elapsed time')
      expect(timer.textContent).toBe('2m 05s')

      vi.useRealTimers()
    })

    it('hides timer when assistant_message arrives and no tokens accumulated', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('Hello')]

      const { rerender } = render(
        <MessagePanel sessionId="sid-1" messages={messages} />
      )

      act(() => {
        vi.advanceTimersByTime(3000)
      })

      expect(screen.getByLabelText('Elapsed time')).toBeInTheDocument()

      // Assistant responds — agent is done, no usage messages
      const updatedMessages: CapybaraMessage[] = [
        ...messages,
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        }
      ]

      rerender(
        <MessagePanel sessionId="sid-1" messages={updatedMessages} />
      )

      expect(
        screen.queryByLabelText('Elapsed time')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText('Token usage')
      ).not.toBeInTheDocument()

      vi.useRealTimers()
    })

    it('keeps running during assistant_text_delta streaming', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createTextDelta('Thinking about this...')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      const timer = screen.getByLabelText('Elapsed time')
      expect(timer).toBeInTheDocument()
      expect(timer.textContent).toBe('2s')

      vi.useRealTimers()
    })

    it('keeps running during tool_use_request', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [
        createUserMessage('Read my file'),
        createTextDelta('Reading...'),
        createToolUseRequest('Read', 'tu-1')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.getByLabelText('Elapsed time')).toBeInTheDocument()

      vi.useRealTimers()
    })

    it('keeps running during tool_result (waiting for assistant to continue)', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [
        createTextDelta('Reading...'),
        createToolUseRequest('Read', 'tu-1'),
        createToolResult('tu-1', 'file contents')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.getByLabelText('Elapsed time')).toBeInTheDocument()

      vi.useRealTimers()
    })

    it('hides timer after error_message with no tokens', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createErrorMessage('Connection lost')
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(
        screen.queryByLabelText('Elapsed time')
      ).not.toBeInTheDocument()

      vi.useRealTimers()
    })

    it('resets timer on new user message after assistant finishes', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [createUserMessage('First')]

      const { rerender } = render(
        <MessagePanel sessionId="sid-1" messages={messages} />
      )

      act(() => {
        vi.advanceTimersByTime(10_000)
      })

      expect(screen.getByLabelText('Elapsed time').textContent).toBe('10s')

      // Assistant finishes
      const afterAssistant: CapybaraMessage[] = [
        ...messages,
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        }
      ]

      rerender(
        <MessagePanel sessionId="sid-1" messages={afterAssistant} />
      )

      // No tokens accumulated, so nothing shown
      expect(
        screen.queryByLabelText('Elapsed time')
      ).not.toBeInTheDocument()

      // User sends a new message
      const withSecondMessage: CapybaraMessage[] = [
        ...afterAssistant,
        createUserMessage('Second')
      ]

      rerender(
        <MessagePanel sessionId="sid-1" messages={withSecondMessage} />
      )

      // Timer should restart — not visible yet (0s hidden)
      expect(
        screen.queryByLabelText('Elapsed time')
      ).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Timer shows 1s, not 11s — it reset
      expect(screen.getByLabelText('Elapsed time').textContent).toBe('1s')

      vi.useRealTimers()
    })
  })

  describe('cumulative token display', () => {
    it('shows tokens next to timer when running with usage messages', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createTextDelta('Working on it...'),
        createUsageMessage()
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      const timer = screen.getByLabelText('Elapsed time')
      // 100 + 50 = 150 tokens -> (150/1000).toFixed(1) = "0.1" or "0.2"
      expect(timer.textContent).toContain('2s')
      expect(timer.textContent).toContain('0.1k tokens')

      vi.useRealTimers()
    })

    it('shows only tokens when idle with accumulated tokens', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        },
        createUsageMessage()  // 100 + 50 = 150 tokens
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const tokenDisplay = screen.getByLabelText('Token usage')
      expect(tokenDisplay.textContent).toBe('0.1k tokens')
    })

    it('accumulates tokens from multiple usage messages', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'First response.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        },
        createUsageMessage(),  // 100 + 50 = 150
        createUserMessage('Second question'),
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Second response.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        },
        {
          kind: 'usage_message',
          sessionId: 'sid-1',
          turnUsage: {
            inputTokens: 2000,
            outputTokens: 500,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          summary: {
            totalInputTokens: 2100,
            totalOutputTokens: 550,
            totalCostUsd: null,
            turnCount: 2
          }
        }  // 2000 + 500 = 2500, cumulative with first = 2650
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const tokenDisplay = screen.getByLabelText('Token usage')
      // 150 + 2500 = 2650 -> (2650/1000).toFixed(1) = "2.6"
      expect(tokenDisplay.textContent).toBe('2.6k tokens')
    })

    it('shows nothing when idle and no tokens', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      expect(screen.queryByLabelText('Elapsed time')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Token usage')).not.toBeInTheDocument()
    })

    it('uses middle dot separator between timer and tokens', () => {
      vi.useFakeTimers()
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        createUsageMessage()
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      const timer = screen.getByLabelText('Elapsed time')
      expect(timer.textContent).toBe('5s \u00b7 0.1k tokens')

      vi.useRealTimers()
    })

    it('formats large cumulative token counts correctly', () => {
      const messages: CapybaraMessage[] = [
        createUserMessage('Hello'),
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Done.' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        },
        {
          kind: 'usage_message',
          sessionId: 'sid-1',
          turnUsage: {
            inputTokens: 3500,
            outputTokens: 700,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          summary: {
            totalInputTokens: 3500,
            totalOutputTokens: 700,
            totalCostUsd: null,
            turnCount: 1
          }
        }
      ]

      render(<MessagePanel sessionId="sid-1" messages={messages} />)

      const tokenDisplay = screen.getByLabelText('Token usage')
      // 3500 + 700 = 4200 -> 4.2k
      expect(tokenDisplay.textContent).toBe('4.2k tokens')
    })
  })
})
