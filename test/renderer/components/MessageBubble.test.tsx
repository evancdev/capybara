import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MessageBubble } from '@/renderer/components/MessageBubble'
import type {
  AssistantTextDelta,
  AssistantMessage,
  ToolUseRequest,
  ToolResult,
  SystemMessage,
  ErrorMessage,
  UsageMessage,
  InterAgentMessage,
  UserMessage,
  MetadataUpdated,
  ThinkingDelta,
  ToolProgress,
  TaskUpdate,
  SessionStateChange,
  ToolUseSummary,
  ContentBlock
} from '@/shared/types/messages'

// ---------------------------------------------------------------------------
// assistant_text_delta
// ---------------------------------------------------------------------------
describe('MessageBubble — assistant_text_delta', () => {
  it('renders streaming text content', () => {
    const message: AssistantTextDelta = {
      kind: 'assistant_text_delta',
      sessionId: 'sid-1',
      text: 'Hello from Claude'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Hello from Claude')).toBeInTheDocument()
  })

  it('renders text with bold markdown', () => {
    const message: AssistantTextDelta = {
      kind: 'assistant_text_delta',
      sessionId: 'sid-1',
      text: 'This is **bold** text'
    }

    render(<MessageBubble message={message} />)

    const boldEl = screen.getByText('bold')
    expect(boldEl).toBeInTheDocument()
    // Streamdown renders bold as <span data-streamdown="strong">
    expect(boldEl.getAttribute('data-streamdown')).toBe('strong')
  })

  it('renders text with inline code', () => {
    const message: AssistantTextDelta = {
      kind: 'assistant_text_delta',
      sessionId: 'sid-1',
      text: 'Use the `hello` function'
    }

    render(<MessageBubble message={message} />)

    const codeEl = screen.getByText('hello')
    expect(codeEl).toBeInTheDocument()
    // Streamdown renders inline code as <code data-streamdown="inline-code">
    expect(codeEl.getAttribute('data-streamdown')).toBe('inline-code')
  })
})

// ---------------------------------------------------------------------------
// assistant_message
// ---------------------------------------------------------------------------
describe('MessageBubble — assistant_message', () => {
  it('renders text blocks from content', () => {
    const message: AssistantMessage = {
      kind: 'assistant_message',
      sessionId: 'sid-1',
      content: [
        { type: 'text', text: 'Here is my response' }
      ],
      model: 'claude-sonnet-4-20250514',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: null,
        cacheCreationTokens: null
      },
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Here is my response')).toBeInTheDocument()
  })

  it('renders nothing when content has no text blocks', () => {
    const message: AssistantMessage = {
      kind: 'assistant_message',
      sessionId: 'sid-1',
      content: [
        {
          type: 'tool_use',
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { file: 'test.ts' }
        }
      ],
      model: 'claude-sonnet-4-20250514',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: null,
        cacheCreationTokens: null
      },
      timestamp: Date.now()
    }

    const { container } = render(<MessageBubble message={message} />)

    // Should render nothing (returns null)
    expect(container.firstChild).toBeNull()
  })

  it('joins multiple text blocks with newlines', () => {
    const message: AssistantMessage = {
      kind: 'assistant_message',
      sessionId: 'sid-1',
      content: [
        { type: 'text', text: 'First paragraph' },
        { type: 'text', text: 'Second paragraph' }
      ],
      model: 'claude-sonnet-4-20250514',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: null,
        cacheCreationTokens: null
      },
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText(/First paragraph/)).toBeInTheDocument()
    expect(screen.getByText(/Second paragraph/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// tool_use_request
// ---------------------------------------------------------------------------
describe('MessageBubble — tool_use_request', () => {
  function createToolUseRequest(
    overrides?: Partial<ToolUseRequest>
  ): ToolUseRequest {
    return {
      kind: 'tool_use_request',
      sessionId: 'sid-1',
      toolUseId: 'tu-1',
      toolName: 'Write',
      input: { file: 'test.ts', content: 'hello' },
      requiresApproval: true,
      ...overrides
    }
  }

  it('renders the tool name', () => {
    render(<MessageBubble message={createToolUseRequest()} />)

    expect(screen.getByText('Write')).toBeInTheDocument()
  })

  it('renders a summary from tool input (file path)', () => {
    render(
      <MessageBubble
        message={createToolUseRequest({
          input: { file: 'src/index.ts', content: 'data' }
        })}
      />
    )

    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  it('shows "approval required" badge when requiresApproval is true', () => {
    render(<MessageBubble message={createToolUseRequest()} />)

    expect(screen.getByText('approval required')).toBeInTheDocument()
  })

  it('does not show "approval required" badge when requiresApproval is false', () => {
    render(
      <MessageBubble
        message={createToolUseRequest({ requiresApproval: false })}
      />
    )

    expect(screen.queryByText('approval required')).not.toBeInTheDocument()
  })

  it('shows approve and deny buttons when requiresApproval is true', () => {
    render(<MessageBubble message={createToolUseRequest()} />)

    expect(screen.getByLabelText('Approve Write')).toBeInTheDocument()
    expect(screen.getByLabelText('Deny Write')).toBeInTheDocument()
  })

  it('approval buttons are disabled (Phase 2 stub)', () => {
    render(<MessageBubble message={createToolUseRequest()} />)

    const approveBtn = screen.getByLabelText('Approve Write')
    const denyBtn = screen.getByLabelText('Deny Write')

    expect(approveBtn).toBeDisabled()
    expect(denyBtn).toBeDisabled()
  })

  it('does not show approval buttons when requiresApproval is false', () => {
    render(
      <MessageBubble
        message={createToolUseRequest({ requiresApproval: false })}
      />
    )

    expect(screen.queryByLabelText('Approve Write')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Deny Write')).not.toBeInTheDocument()
  })

  it('expands to show tool input when header is clicked', () => {
    const input = { file_path: 'expanded.ts', content: 'data' }
    render(
      <MessageBubble
        message={createToolUseRequest({ input })}
      />
    )

    // Formatted input body should not be visible initially
    const header = screen.getByRole('button', { name: /Tool: Write/i })
    expect(screen.queryByText('data')).not.toBeInTheDocument()

    // Click the header to expand
    fireEvent.click(header)

    // Human-readable formatted input should now be visible (file path + content preview)
    expect(screen.getAllByText('expanded.ts').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('data')).toBeInTheDocument()
  })

  it('collapses tool input when header is clicked again', () => {
    render(
      <MessageBubble
        message={createToolUseRequest({
          input: { file_path: 'test.ts', content: 'hello' }
        })}
      />
    )

    const header = screen.getByRole('button', { name: /Tool: Write/i })

    // Expand
    fireEvent.click(header)
    expect(screen.getByText('hello')).toBeInTheDocument()

    // Collapse
    fireEvent.click(header)
    expect(screen.queryByText('hello')).not.toBeInTheDocument()
  })

  it('has correct aria-expanded attribute', () => {
    render(<MessageBubble message={createToolUseRequest()} />)

    const header = screen.getByRole('button', { name: /Tool: Write/i })

    expect(header).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })
})

// ---------------------------------------------------------------------------
// tool_result
// ---------------------------------------------------------------------------
describe('MessageBubble — tool_result', () => {
  function createToolResult(
    overrides?: Partial<ToolResult>
  ): ToolResult {
    return {
      kind: 'tool_result',
      sessionId: 'sid-1',
      toolUseId: 'tu-1',
      output: 'File contents here',
      isError: false,
      ...overrides
    }
  }

  /** Helper: build output with a given number of lines */
  function multiLineOutput(lineCount: number, prefix = 'line'): string {
    return Array.from({ length: lineCount }, (_, i) => `${prefix} ${i + 1}`).join('\n')
  }

  it('renders tool output text', () => {
    render(<MessageBubble message={createToolResult()} />)

    expect(screen.getByText('File contents here')).toBeInTheDocument()
  })

  it('applies error styling when isError is true', () => {
    const { container } = render(
      <MessageBubble message={createToolResult({ isError: true })} />
    )

    // Error result should have the error class
    const errorEl = container.querySelector('[class*="toolResultBodyError"]')
    expect(errorEl).not.toBeNull()
  })

  it('truncates output with more than 10 lines', () => {
    const output = multiLineOutput(20)
    render(
      <MessageBubble message={createToolResult({ output })} />
    )

    // Should show "Show more" with line count
    expect(screen.getByText('Show more (20 lines)')).toBeInTheDocument()

    // First 10 lines should be visible
    expect(screen.getByText(/line 10/)).toBeInTheDocument()
    // Lines beyond 10 should not be visible
    expect(screen.queryByText(/line 11/)).not.toBeInTheDocument()
  })

  it('does not truncate output with 10 or fewer lines', () => {
    const output = multiLineOutput(8)
    render(
      <MessageBubble message={createToolResult({ output })} />
    )

    // Should NOT show "Show more" button
    expect(screen.queryByText(/Show more/)).not.toBeInTheDocument()
  })

  it('expands truncated output when "Show more" is clicked', () => {
    const output = multiLineOutput(25, 'data')
    render(
      <MessageBubble message={createToolResult({ output })} />
    )

    const showMoreBtn = screen.getByText('Show more (25 lines)')
    fireEvent.click(showMoreBtn)

    // All lines should now be visible
    expect(screen.getByText(/data 25/)).toBeInTheDocument()
    // Button text should change
    expect(screen.getByText('Show less')).toBeInTheDocument()
  })

  it('collapses expanded output when "Show less" is clicked', () => {
    const output = multiLineOutput(15)
    render(
      <MessageBubble message={createToolResult({ output })} />
    )

    // Expand
    fireEvent.click(screen.getByText('Show more (15 lines)'))
    // Collapse
    fireEvent.click(screen.getByText('Show less'))

    // Should show truncated again
    expect(screen.getByText('Show more (15 lines)')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Diff rendering
  // ---------------------------------------------------------------------------

  it('renders diff output with colored lines', () => {
    const diffOutput = [
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4'
    ].join('\n')

    const { container } = render(
      <MessageBubble message={createToolResult({ output: diffOutput })} />
    )

    // Diff lines should have diff-specific classes
    const addLines = container.querySelectorAll('[class*="diffAdd"]')
    const removeLines = container.querySelectorAll('[class*="diffRemove"]')
    const hunkLines = container.querySelectorAll('[class*="diffHunk"]')
    const metaLines = container.querySelectorAll('[class*="diffMeta"]')

    expect(addLines).toHaveLength(2)
    expect(removeLines).toHaveLength(1)
    expect(hunkLines).toHaveLength(1)
    expect(metaLines).toHaveLength(2)
  })

  it('does not apply diff styling to non-diff output', () => {
    const output = 'Just some normal text\nwith multiple lines'

    const { container } = render(
      <MessageBubble message={createToolResult({ output })} />
    )

    const diffLines = container.querySelectorAll('[class*="diffLine"]')
    expect(diffLines).toHaveLength(0)
  })

  it('detects diff by @@ hunk markers', () => {
    const diffOutput = [
      '@@ -10,5 +10,6 @@',
      ' context line',
      '-removed line',
      '+added line'
    ].join('\n')

    const { container } = render(
      <MessageBubble message={createToolResult({ output: diffOutput })} />
    )

    const diffLines = container.querySelectorAll('[class*="diffLine"]')
    expect(diffLines.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// system_message
// ---------------------------------------------------------------------------
describe('MessageBubble — system_message', () => {
  it('renders nothing for init messages (hidden in terminal aesthetic)', () => {
    const message: SystemMessage = {
      kind: 'system_message',
      sessionId: 'sid-1',
      messageType: 'init',
      text: '{"model":"claude-sonnet-4-20250514","tools":["Read"]}'
    }

    const { container } = render(<MessageBubble message={message} />)

    // init messages return null — startup animation covers this
    expect(container.firstChild).toBeNull()
  })

  it('renders compact_boundary as a divider', () => {
    const message: SystemMessage = {
      kind: 'system_message',
      sessionId: 'sid-1',
      messageType: 'compact_boundary',
      text: 'Context window compacted'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('context compacted')).toBeInTheDocument()
  })

  it('has role="status" for compact_boundary accessibility', () => {
    const message: SystemMessage = {
      kind: 'system_message',
      sessionId: 'sid-1',
      messageType: 'compact_boundary',
      text: 'Context window compacted'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// error_message
// ---------------------------------------------------------------------------
describe('MessageBubble — error_message', () => {
  it('renders error message text', () => {
    const message: ErrorMessage = {
      kind: 'error_message',
      sessionId: 'sid-1',
      code: 'unknown',
      message: 'Rate limit exceeded',
      recoverable: false
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument()
  })

  it('renders error code', () => {
    const message: ErrorMessage = {
      kind: 'error_message',
      sessionId: 'sid-1',
      code: 'context_limit',
      message: 'Context too long',
      recoverable: true
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('context_limit')).toBeInTheDocument()
  })

  it('has role="alert" for accessibility', () => {
    const message: ErrorMessage = {
      kind: 'error_message',
      sessionId: 'sid-1',
      code: 'unknown',
      message: 'Something broke',
      recoverable: false
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// usage_message
// ---------------------------------------------------------------------------
describe('MessageBubble — usage_message', () => {
  function createUsageMessage(
    overrides?: Partial<UsageMessage>
  ): UsageMessage {
    return {
      kind: 'usage_message',
      sessionId: 'sid-1',
      turnUsage: {
        inputTokens: 1500,
        outputTokens: 300,
        cacheReadTokens: null,
        cacheCreationTokens: null
      },
      summary: {
        totalInputTokens: 3000,
        totalOutputTokens: 600,
        totalCostUsd: null,
        turnCount: 2
      },
      ...overrides
    }
  }

  it('renders nothing (usage moved to status bar)', () => {
    const { container } = render(<MessageBubble message={createUsageMessage()} />)

    // usage_message returns null — tokens are shown in the status bar instead
    expect(container.firstChild).toBeNull()
  })

  it('does not render token count inline', () => {
    render(<MessageBubble message={createUsageMessage()} />)

    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Token usage')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// inter_agent_message
// ---------------------------------------------------------------------------
describe('MessageBubble — inter_agent_message', () => {
  it('renders sender name', () => {
    const message: InterAgentMessage = {
      kind: 'inter_agent_message',
      sessionId: 'sid-1',
      fromSessionId: 'sid-2',
      fromSessionName: 'Agent Alpha',
      content: 'Collaboration request',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('From Agent Alpha')).toBeInTheDocument()
  })

  it('renders message content', () => {
    const message: InterAgentMessage = {
      kind: 'inter_agent_message',
      sessionId: 'sid-1',
      fromSessionId: 'sid-2',
      fromSessionName: 'Agent Beta',
      content: 'Please review this file',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Please review this file')).toBeInTheDocument()
  })

  it('renders markdown in inter-agent content', () => {
    const message: InterAgentMessage = {
      kind: 'inter_agent_message',
      sessionId: 'sid-1',
      fromSessionId: 'sid-2',
      fromSessionName: 'Agent',
      content: 'Check `config.ts` for details',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    const codeEl = screen.getByText('config.ts')
    expect(codeEl).toBeInTheDocument()
    // Streamdown renders inline code as <code data-streamdown="inline-code">
    expect(codeEl.getAttribute('data-streamdown')).toBe('inline-code')
  })
})

// ---------------------------------------------------------------------------
// user_message
// ---------------------------------------------------------------------------
describe('MessageBubble — user_message', () => {
  it('renders user message text', () => {
    const message: UserMessage = {
      kind: 'user_message',
      sessionId: 'sid-1',
      text: 'What is the meaning of life?',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('What is the meaning of life?')).toBeInTheDocument()
  })

  it('renders a > prompt symbol', () => {
    const message: UserMessage = {
      kind: 'user_message',
      sessionId: 'sid-1',
      text: 'Hello Claude',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('>')).toBeInTheDocument()
  })

  it('marks the prompt symbol as aria-hidden', () => {
    const message: UserMessage = {
      kind: 'user_message',
      sessionId: 'sid-1',
      text: 'Hello',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    const promptSymbol = screen.getByText('>')
    expect(promptSymbol).toHaveAttribute('aria-hidden', 'true')
  })

  it('preserves whitespace in user message text', () => {
    const message: UserMessage = {
      kind: 'user_message',
      sessionId: 'sid-1',
      text: 'line one\nline two',
      timestamp: Date.now()
    }

    render(<MessageBubble message={message} />)

    // getByText normalises whitespace by default; use a custom normaliser
    // to verify the newline is preserved in the DOM.
    expect(
      screen.getByText('line one\nline two', { normalizer: (s) => s })
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// metadata_updated
// ---------------------------------------------------------------------------
describe('MessageBubble — metadata_updated', () => {
  it('renders nothing (internal-only message)', () => {
    const message: MetadataUpdated = {
      kind: 'metadata_updated',
      sessionId: 'sid-1',
      metadata: {
        model: 'claude-opus-4-20250514',
        contextWindow: '200k'
      }
    }

    const { container } = render(<MessageBubble message={message} />)

    // metadata_updated returns null — not a visible message
    expect(container.firstChild).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// thinking_delta
// ---------------------------------------------------------------------------
describe('MessageBubble — thinking_delta', () => {
  it('renders a collapsed thinking section', () => {
    const message: ThinkingDelta = {
      kind: 'thinking_delta',
      sessionId: 'sid-1',
      text: 'Let me analyze this problem step by step...'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    // Thinking text should NOT be visible initially (collapsed)
    expect(screen.queryByText('Let me analyze this problem step by step...')).not.toBeInTheDocument()
  })

  it('expands to show thinking text when clicked', () => {
    const message: ThinkingDelta = {
      kind: 'thinking_delta',
      sessionId: 'sid-1',
      text: 'Step 1: Consider the inputs'
    }

    render(<MessageBubble message={message} />)

    const header = screen.getByLabelText(/Thinking section/)
    fireEvent.click(header)

    expect(screen.getByText('Step 1: Consider the inputs')).toBeInTheDocument()
  })

  it('collapses thinking text when clicked again', () => {
    const message: ThinkingDelta = {
      kind: 'thinking_delta',
      sessionId: 'sid-1',
      text: 'Hidden thinking'
    }

    render(<MessageBubble message={message} />)

    const header = screen.getByLabelText(/Thinking section/)
    fireEvent.click(header) // expand
    fireEvent.click(header) // collapse

    expect(screen.queryByText('Hidden thinking')).not.toBeInTheDocument()
  })

  it('has correct aria-expanded attribute', () => {
    const message: ThinkingDelta = {
      kind: 'thinking_delta',
      sessionId: 'sid-1',
      text: 'thinking text'
    }

    render(<MessageBubble message={message} />)

    const header = screen.getByLabelText(/Thinking section/)
    expect(header).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
  })
})

// ---------------------------------------------------------------------------
// tool_progress
// ---------------------------------------------------------------------------
describe('MessageBubble — tool_progress', () => {
  it('renders tool name and elapsed time', () => {
    const message: ToolProgress = {
      kind: 'tool_progress',
      sessionId: 'sid-1',
      toolName: 'Read',
      toolUseId: 'tu-1',
      elapsedSeconds: 3
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('(3s)')).toBeInTheDocument()
  })

  it('has accessible label with tool name and elapsed time', () => {
    const message: ToolProgress = {
      kind: 'tool_progress',
      sessionId: 'sid-1',
      toolName: 'Write',
      toolUseId: 'tu-2',
      elapsedSeconds: 7
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByLabelText('Write running for 7s')).toBeInTheDocument()
  })

  it('has role="status"', () => {
    const message: ToolProgress = {
      kind: 'tool_progress',
      sessionId: 'sid-1',
      toolName: 'Bash',
      toolUseId: 'tu-3',
      elapsedSeconds: 1
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows an animated spinner', () => {
    vi.useFakeTimers()

    const message: ToolProgress = {
      kind: 'tool_progress',
      sessionId: 'sid-1',
      toolName: 'Read',
      toolUseId: 'tu-1',
      elapsedSeconds: 2
    }

    render(<MessageBubble message={message} />)

    const indicator = screen.getByRole('status')
    const initialContent = indicator.textContent

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const updatedContent = indicator.textContent
    expect(updatedContent).not.toBe(initialContent)

    vi.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// task_update
// ---------------------------------------------------------------------------
describe('MessageBubble — task_update', () => {
  it('renders started status', () => {
    const message: TaskUpdate = {
      kind: 'task_update',
      sessionId: 'sid-1',
      taskId: 'task-1',
      status: 'started',
      description: 'Analyze test coverage'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText(/Task started: Analyze test coverage/)).toBeInTheDocument()
  })

  it('renders progress status with summary', () => {
    const message: TaskUpdate = {
      kind: 'task_update',
      sessionId: 'sid-1',
      taskId: 'task-1',
      status: 'progress',
      summary: 'Found 3 uncovered branches'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Found 3 uncovered branches')).toBeInTheDocument()
  })

  it('renders completed status with summary', () => {
    const message: TaskUpdate = {
      kind: 'task_update',
      sessionId: 'sid-1',
      taskId: 'task-1',
      status: 'completed',
      summary: 'Coverage improved to 94%'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText(/Task completed: Coverage improved to 94%/)).toBeInTheDocument()
  })

  it('has role="status" for all statuses', () => {
    const message: TaskUpdate = {
      kind: 'task_update',
      sessionId: 'sid-1',
      taskId: 'task-1',
      status: 'started',
      description: 'Running analysis'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('handles missing optional fields gracefully', () => {
    const message: TaskUpdate = {
      kind: 'task_update',
      sessionId: 'sid-1',
      taskId: 'task-1',
      status: 'progress'
    }

    render(<MessageBubble message={message} />)

    // Should still render without crashing
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// session_state
// ---------------------------------------------------------------------------
describe('MessageBubble — session_state', () => {
  it('renders nothing for idle state', () => {
    const message: SessionStateChange = {
      kind: 'session_state',
      sessionId: 'sid-1',
      state: 'idle'
    }

    const { container } = render(<MessageBubble message={message} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for running state', () => {
    const message: SessionStateChange = {
      kind: 'session_state',
      sessionId: 'sid-1',
      state: 'running'
    }

    const { container } = render(<MessageBubble message={message} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders waiting indicator for requires_action state', () => {
    const message: SessionStateChange = {
      kind: 'session_state',
      sessionId: 'sid-1',
      state: 'requires_action'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Waiting for input...')).toBeInTheDocument()
    expect(screen.getByLabelText('Waiting for input')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// tool_use_summary
// ---------------------------------------------------------------------------
describe('MessageBubble — tool_use_summary', () => {
  it('renders summary text', () => {
    const message: ToolUseSummary = {
      kind: 'tool_use_summary',
      sessionId: 'sid-1',
      summary: 'Created file src/utils/helper.ts with 42 lines'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Summary:')).toBeInTheDocument()
    expect(screen.getByText('Created file src/utils/helper.ts with 42 lines')).toBeInTheDocument()
  })

  it('has role="status"', () => {
    const message: ToolUseSummary = {
      kind: 'tool_use_summary',
      sessionId: 'sid-1',
      summary: 'Read 120 lines from config.ts'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// assistant_message with new content block types
// ---------------------------------------------------------------------------
describe('MessageBubble — assistant_message with extended content blocks', () => {
  function createAssistantMessage(content: ContentBlock[]): AssistantMessage {
    return {
      kind: 'assistant_message',
      sessionId: 'sid-1',
      content,
      model: 'claude-sonnet-4-20250514',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: null,
        cacheCreationTokens: null
      },
      timestamp: Date.now()
    }
  }

  it('renders thinking block as expandable section', () => {
    const message = createAssistantMessage([
      { type: 'thinking', thinking: 'Deep analysis here' } as ContentBlock,
      { type: 'text', text: 'Here is my answer' }
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    expect(screen.getByText('Here is my answer')).toBeInTheDocument()
    // Thinking text is collapsed by default
    expect(screen.queryByText('Deep analysis here')).not.toBeInTheDocument()
  })

  it('renders redacted_thinking block', () => {
    const message = createAssistantMessage([
      { type: 'redacted_thinking' } as ContentBlock,
      { type: 'text', text: 'Visible answer' }
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('[thinking redacted]')).toBeInTheDocument()
    expect(screen.getByText('Visible answer')).toBeInTheDocument()
  })

  it('renders server_tool_use block like a tool row', () => {
    const message = createAssistantMessage([
      {
        type: 'server_tool_use',
        toolUseId: 'stu-1',
        toolName: 'web_search',
        input: { query: 'test' }
      } as ContentBlock
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('web_search')).toBeInTheDocument()
  })

  it('renders web_search_tool_result with links', () => {
    const message = createAssistantMessage([
      {
        type: 'web_search_tool_result',
        toolUseId: 'ws-1',
        searchQuery: 'React hooks best practices',
        results: [
          {
            title: 'React Hooks Guide',
            url: 'https://example.com/hooks',
            snippet: 'A comprehensive guide to React hooks.'
          }
        ]
      } as ContentBlock
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Search: React hooks best practices')).toBeInTheDocument()
    const link = screen.getByText('React Hooks Guide')
    expect(link).toBeInTheDocument()
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com/hooks')
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
    expect(link.closest('a')).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('A comprehensive guide to React hooks.')).toBeInTheDocument()
  })

  it('renders unknown content block type as dimmed fallback', () => {
    const message = createAssistantMessage([
      { type: 'unknown', rawType: 'future_block', data: '{}' } as ContentBlock,
      { type: 'text', text: 'After unknown block' }
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('[future_block]')).toBeInTheDocument()
    expect(screen.getByText('After unknown block')).toBeInTheDocument()
  })

  it('renders mcp_tool_use block with server and tool name', () => {
    const message = createAssistantMessage([
      {
        type: 'mcp_tool_use',
        toolUseId: 'mcp-1',
        serverName: 'github',
        toolName: 'list_repos',
        input: { org: 'anthropic' }
      } as ContentBlock
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('github/list_repos')).toBeInTheDocument()
  })

  it('renders mcp_tool_result block', () => {
    const message = createAssistantMessage([
      {
        type: 'mcp_tool_result',
        toolUseId: 'mcp-1',
        output: 'Found 5 repositories',
        isError: false
      } as ContentBlock
    ])

    render(<MessageBubble message={message} />)

    expect(screen.getByText('Found 5 repositories')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// tool_use_request with enhanced approval fields
// ---------------------------------------------------------------------------
describe('MessageBubble — tool_use_request with approval context', () => {
  it('renders title, description, and reason when present', () => {
    const message: ToolUseRequest = {
      kind: 'tool_use_request',
      sessionId: 'sid-1',
      toolUseId: 'tu-1',
      toolName: 'Write',
      input: { file_path: 'src/main/index.ts' },
      requiresApproval: true,
      title: 'Claude wants to edit src/main/index.ts',
      description: 'Modifying the main entry point',
      reason: 'Claude will have read and write access to files'
    }

    render(<MessageBubble message={message} />)

    expect(screen.getByText(/Claude wants to edit src\/main\/index\.ts/)).toBeInTheDocument()
    expect(screen.getByText('Modifying the main entry point')).toBeInTheDocument()
    expect(screen.getByText(/Reason: Claude will have read and write access to files/)).toBeInTheDocument()
  })

  it('does not render approval context when fields are absent', () => {
    const message: ToolUseRequest = {
      kind: 'tool_use_request',
      sessionId: 'sid-1',
      toolUseId: 'tu-1',
      toolName: 'Read',
      input: { file_path: 'test.ts' },
      requiresApproval: true
    }

    render(<MessageBubble message={message} />)

    // Buttons should still exist
    expect(screen.getByLabelText('Approve Read')).toBeInTheDocument()
    // But no title/description/reason text
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument()
  })
})
