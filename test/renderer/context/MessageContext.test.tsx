import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  MessageProvider,
  useMessages
} from '@/renderer/context/MessageContext'
import type { CapybaraMessage, ToolApprovalRequest } from '@/shared/types/messages'

function wrapper({ children }: { children: ReactNode }) {
  return <MessageProvider>{children}</MessageProvider>
}

function renderMessageHook() {
  return renderHook(() => useMessages(), { wrapper })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MessageContext', () => {
  describe('useMessages outside provider', () => {
    it('throws when used outside of MessageProvider', () => {
      // renderHook wraps the error, so we need to catch it
      expect(() => {
        renderHook(() => useMessages())
      }).toThrow('useMessages must be used within a MessageProvider')
    })
  })

  describe('messages()', () => {
    it('returns empty array for unknown session', () => {
      const { result } = renderMessageHook()

      const messages = result.current.messages('nonexistent-session')

      expect(messages).toEqual([])
    })

    it('returns a single accumulated delta for streaming text', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'Hello'
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({
        kind: 'assistant_text_delta',
        sessionId: 'sid-1',
        text: 'Hello'
      })
    })

    it('accumulates multiple deltas into a single message', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'First'
        })
      })

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: ' Second'
        })
      })

      const messages = result.current.messages('sid-1')
      // Should be ONE accumulated message, not two separate ones
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        kind: 'assistant_text_delta',
        text: 'First Second'
      })
    })

    it('replaces accumulated delta with final assistant_message', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // Stream deltas
      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'It'
        })
      })

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: ' works'
        })
      })

      // Final message arrives
      act(() => {
        messageCallback!({
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'It works' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        })
      })

      const messages = result.current.messages('sid-1')
      // Should be ONE assistant_message, no dangling deltas
      expect(messages).toHaveLength(1)
      expect(messages[0].kind).toBe('assistant_message')
    })

    it('keeps messages for different sessions separate', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'Session 1 message'
        })
      })

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-2',
          text: 'Session 2 message'
        })
      })

      expect(result.current.messages('sid-1')).toHaveLength(1)
      expect(result.current.messages('sid-2')).toHaveLength(1)
    })

    it('preserves non-delta messages in chronological order with accumulated delta', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // system_message first
      act(() => {
        messageCallback!({
          kind: 'system_message',
          sessionId: 'sid-1',
          messageType: 'init',
          text: '{"model":"claude-sonnet-4-20250514"}'
        })
      })

      // Then streaming deltas
      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'Let me '
        })
      })

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'help you'
        })
      })

      const messages = result.current.messages('sid-1')
      // system_message + one accumulated delta
      expect(messages).toHaveLength(2)
      expect(messages[0].kind).toBe('system_message')
      expect(messages[1]).toMatchObject({
        kind: 'assistant_text_delta',
        text: 'Let me help you'
      })
    })

    it('inserts delta at correct position when non-delta messages arrive during streaming', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // Deltas start
      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'I will read the file'
        })
      })

      // tool_use_request arrives (stored after delta position)
      act(() => {
        messageCallback!({
          kind: 'tool_use_request',
          sessionId: 'sid-1',
          toolUseId: 'tu-1',
          toolName: 'Read',
          input: { file: 'test.ts' },
          requiresApproval: false
        })
      })

      const messages = result.current.messages('sid-1')
      // Accumulated delta at index 0, tool_use_request at index 1
      expect(messages).toHaveLength(2)
      expect(messages[0].kind).toBe('assistant_text_delta')
      expect(messages[1].kind).toBe('tool_use_request')
    })

    it('appends non-delta messages normally', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'system_message',
          sessionId: 'sid-1',
          messageType: 'init',
          text: '{"model":"claude-sonnet-4-20250514"}'
        })
      })

      act(() => {
        messageCallback!({
          kind: 'error_message',
          sessionId: 'sid-1',
          code: 'unknown',
          message: 'Something failed',
          recoverable: true
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(2)
      expect(messages[0].kind).toBe('system_message')
      expect(messages[1].kind).toBe('error_message')
    })
  })

  describe('onToolApprovalRequest listener', () => {
    it('surfaces tool approval requests as tool_use_request messages', () => {
      let toolCallback: ((req: ToolApprovalRequest) => void) | null = null
      vi.mocked(window.sessionAPI.onToolApprovalRequest).mockImplementation(
        (cb: (req: ToolApprovalRequest) => void) => {
          toolCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        toolCallback!({
          sessionId: 'sid-1',
          toolUseId: 'tu-1',
          toolName: 'Write',
          input: { file: 'test.ts' },
          timeoutMs: 30000
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        kind: 'tool_use_request',
        requiresApproval: true,
        toolName: 'Write'
      })
    })
  })

  describe('sendMessage()', () => {
    it('calls window.sessionAPI.sendMessage', async () => {
      const { result } = renderMessageHook()

      await act(async () => {
        await result.current.sendMessage('sid-1', 'Hello Claude')
      })

      expect(window.sessionAPI.sendMessage).toHaveBeenCalledWith(
        'sid-1',
        'Hello Claude'
      )
    })

    it('injects a local user_message into the message list', async () => {
      const { result } = renderMessageHook()

      await act(async () => {
        await result.current.sendMessage('sid-1', 'Hello Claude')
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        kind: 'user_message',
        text: 'Hello Claude',
        sessionId: 'sid-1',
        timestamp: expect.any(Number) as unknown
      })
    })

    it('places user_message before subsequent assistant messages', async () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // User sends a message
      await act(async () => {
        await result.current.sendMessage('sid-1', 'What is 2+2?')
      })

      // Assistant responds with a delta
      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'The answer is 4.'
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(2)
      expect(messages[0].kind).toBe('user_message')
      expect(messages[1].kind).toBe('assistant_text_delta')
    })
  })

  describe('respondToToolApproval()', () => {
    it('calls window.sessionAPI.respondToToolApproval', async () => {
      const { result } = renderMessageHook()

      const response = {
        sessionId: 'sid-1',
        toolUseId: 'tu-1',
        decision: 'approve' as const,
        message: null
      }

      await act(async () => {
        await result.current.respondToToolApproval(response)
      })

      expect(window.sessionAPI.respondToToolApproval).toHaveBeenCalledWith(
        response
      )
    })
  })

  describe('context value updates on message arrival', () => {
    it('changes context identity so consumers re-render when a bridge message arrives', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      const valueBefore = result.current

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'Hello'
        })
      })

      const valueAfter = result.current

      // The context value object must be a different reference so that
      // consumers (like SessionLayout) re-render via React context.
      expect(valueBefore).not.toBe(valueAfter)
    })

    it('changes context identity when sendMessage injects a user message', async () => {
      const { result } = renderMessageHook()

      const valueBefore = result.current

      await act(async () => {
        await result.current.sendMessage('sid-1', 'Test')
      })

      const valueAfter = result.current

      expect(valueBefore).not.toBe(valueAfter)
    })
  })

  describe('sessionMetadata()', () => {
    it('returns undefined for unknown session', () => {
      const { result } = renderMessageHook()

      const meta = result.current.sessionMetadata('nonexistent')

      expect(meta).toBeUndefined()
    })

    it('stores metadata from metadata_updated messages', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'metadata_updated',
          sessionId: 'sid-1',
          metadata: {
            model: 'claude-opus-4-20250514',
            contextWindow: '200k'
          }
        })
      })

      const meta = result.current.sessionMetadata('sid-1')
      expect(meta).toEqual({
        model: 'claude-opus-4-20250514',
        contextWindow: '200k'
      })
    })

    it('does not add metadata_updated to the messages list', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'metadata_updated',
          sessionId: 'sid-1',
          metadata: {
            model: 'claude-opus-4-20250514',
            contextWindow: '200k'
          }
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toEqual([])
    })

    it('merges incremental metadata updates', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // First update: version info
      act(() => {
        messageCallback!({
          kind: 'metadata_updated',
          sessionId: 'sid-1',
          metadata: {
            claudeCodeVersion: '2.1.87'
          }
        })
      })

      // Second update: model info (after SDK init)
      act(() => {
        messageCallback!({
          kind: 'metadata_updated',
          sessionId: 'sid-1',
          metadata: {
            model: 'claude-opus-4-20250514',
            contextWindow: '200k'
          }
        })
      })

      const meta = result.current.sessionMetadata('sid-1')
      expect(meta).toEqual({
        claudeCodeVersion: '2.1.87',
        model: 'claude-opus-4-20250514',
        contextWindow: '200k'
      })
    })

    it('keeps metadata separate per session', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'metadata_updated',
          sessionId: 'sid-1',
          metadata: { model: 'model-a' }
        })
      })

      act(() => {
        messageCallback!({
          kind: 'metadata_updated',
          sessionId: 'sid-2',
          metadata: { model: 'model-b' }
        })
      })

      expect(result.current.sessionMetadata('sid-1')?.model).toBe('model-a')
      expect(result.current.sessionMetadata('sid-2')?.model).toBe('model-b')
    })
  })

  describe('thinking_delta accumulation', () => {
    it('accumulates thinking deltas into a single message', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      act(() => {
        messageCallback!({
          kind: 'thinking_delta',
          sessionId: 'sid-1',
          text: 'Step 1: '
        })
      })

      act(() => {
        messageCallback!({
          kind: 'thinking_delta',
          sessionId: 'sid-1',
          text: 'Analyze the input'
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        kind: 'thinking_delta',
        text: 'Step 1: Analyze the input'
      })
    })

    it('shows both thinking delta and text delta during streaming', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // Thinking starts first
      act(() => {
        messageCallback!({
          kind: 'thinking_delta',
          sessionId: 'sid-1',
          text: 'Let me think...'
        })
      })

      // Then text deltas arrive
      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'Here is my answer'
        })
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(2)
      expect(messages[0].kind).toBe('thinking_delta')
      expect(messages[1].kind).toBe('assistant_text_delta')
    })

    it('clears thinking buffer when assistant_message arrives', () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      const { result } = renderMessageHook()

      // Stream thinking + text
      act(() => {
        messageCallback!({
          kind: 'thinking_delta',
          sessionId: 'sid-1',
          text: 'thinking...'
        })
      })

      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'response text'
        })
      })

      // Final message replaces everything
      act(() => {
        messageCallback!({
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [
            { type: 'thinking', thinking: 'thinking...' },
            { type: 'text', text: 'response text' }
          ],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: Date.now()
        })
      })

      const messages = result.current.messages('sid-1')
      // Should be just the final assistant_message, no dangling deltas
      expect(messages).toHaveLength(1)
      expect(messages[0].kind).toBe('assistant_message')
    })
  })

  describe('loadMessages()', () => {
    it('fetches messages from the backend and seeds the store', async () => {
      const historicalMessages: CapybaraMessage[] = [
        {
          kind: 'user_message',
          sessionId: 'sid-1',
          text: 'Hello from history',
          timestamp: 1000
        },
        {
          kind: 'assistant_message',
          sessionId: 'sid-1',
          content: [{ type: 'text', text: 'Hello back from history' }],
          model: 'claude-sonnet-4-20250514',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: null,
            cacheCreationTokens: null
          },
          timestamp: 2000
        }
      ]
      vi.mocked(window.sessionAPI.getMessages).mockResolvedValue(
        historicalMessages
      )

      const { result } = renderMessageHook()

      // Before loading, no messages
      expect(result.current.messages('sid-1')).toEqual([])

      await act(async () => {
        await result.current.loadMessages('sid-1')
      })

      const messages = result.current.messages('sid-1')
      expect(messages).toHaveLength(2)
      expect(messages[0].kind).toBe('user_message')
      expect(messages[1].kind).toBe('assistant_message')
    })

    it('does not overwrite existing messages from onMessage listener', async () => {
      let messageCallback: ((msg: CapybaraMessage) => void) | null = null
      vi.mocked(window.sessionAPI.onMessage).mockImplementation(
        (cb: (msg: CapybaraMessage) => void) => {
          messageCallback = cb
          return () => {}
        }
      )

      vi.mocked(window.sessionAPI.getMessages).mockResolvedValue([
        {
          kind: 'user_message',
          sessionId: 'sid-1',
          text: 'Old message from backend',
          timestamp: 1000
        }
      ])

      const { result } = renderMessageHook()

      // Receive a live message first
      act(() => {
        messageCallback!({
          kind: 'assistant_text_delta',
          sessionId: 'sid-1',
          text: 'Live streaming text'
        })
      })

      // Now load — should skip because messages already exist
      await act(async () => {
        await result.current.loadMessages('sid-1')
      })

      const messages = result.current.messages('sid-1')
      // Should still have the live message, not the backend fetch
      expect(messages).toHaveLength(1)
      expect(messages[0].kind).toBe('assistant_text_delta')
    })

    it('is a no-op when backend returns empty array', async () => {
      vi.mocked(window.sessionAPI.getMessages).mockResolvedValue([])

      const { result } = renderMessageHook()

      await act(async () => {
        await result.current.loadMessages('sid-1')
      })

      expect(result.current.messages('sid-1')).toEqual([])
    })
  })

  describe('listener cleanup on unmount', () => {
    it('calls unsubscribe functions on unmount', () => {
      const unsubMessage = vi.fn()
      const unsubToolApproval = vi.fn()
      vi.mocked(window.sessionAPI.onMessage).mockReturnValue(unsubMessage)
      vi.mocked(window.sessionAPI.onToolApprovalRequest).mockReturnValue(
        unsubToolApproval
      )

      const { unmount } = renderMessageHook()

      unmount()

      expect(unsubMessage).toHaveBeenCalledOnce()
      expect(unsubToolApproval).toHaveBeenCalledOnce()
    })
  })
})
