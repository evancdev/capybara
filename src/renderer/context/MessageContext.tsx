import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo
} from 'react'
import type { ReactNode } from 'react'
import type {
  AssistantTextDelta,
  ThinkingDelta,
  CapybaraMessage,
  UserMessage,
  ToolApprovalRequest,
  ToolApprovalResponse
} from '@/shared/types/messages'
import type { SessionMetadata } from '@/shared/types/session'

// ---------------------------------------------------------------------------
// MessageContext — renderer-side mirror of main's MessageHistoryStore
// ---------------------------------------------------------------------------
//
// Main's MessageHistoryStore is the single source of truth for a session's
// message log. This context is a strict append-only mirror of that log,
// populated by two mechanisms:
//
//   1. Live streaming: onMessage events are ingested in order as they arrive.
//   2. Hydration: on session open/resume, loadMessages() fetches a snapshot
//      from main and reconciles it with whatever has already streamed in.
//
// Because both mechanisms pull from the same ordered append-only log, the
// reconciliation is simple: the renderer tracks how many raw events it has
// ingested per session (`ingestedCountRef`). If a hydration snapshot contains
// more events than we've ingested, we replay the missing suffix through the
// same ingest logic. If we've already ingested ahead of the snapshot (because
// live events arrived during the fetch), we discard the snapshot as stale.
//
// To protect against a live event for slot i < snapshot.length arriving
// AFTER the snapshot reply (which could happen across different IPC
// channels), hydration sets a per-session "hydrating" flag and buffers any
// incoming live events until reconciliation completes. This guarantees
// every message is ingested exactly once, in order.
//
// The delta buffers (`deltaBufferRef`, `thinkingBufferRef`) are UI-layer
// accumulation helpers — they don't duplicate state from main, they just
// coalesce individual delta events into a single synthetic display entry
// so streaming text renders smoothly without allocating a new DOM node per
// token. They are cleared when the final assistant_message arrives.

interface MessageContextValue {
  /** Get all messages for a given session. Returns empty array if none. */
  messages: (sessionId: string) => CapybaraMessage[]
  /** Get the latest metadata for a given session. Returns undefined if none. */
  sessionMetadata: (sessionId: string) => SessionMetadata | undefined
  /** Send a user message to a session. */
  sendMessage: (sessionId: string, text: string) => Promise<void>
  /**
   * Send an inter-agent message from one session to another. Fire-and-forget
   * from the renderer's perspective: the message comes back through the
   * existing SESSION_MESSAGE pipeline to the target session, so no local
   * state mutation or optimistic update is needed here.
   */
  sendInterAgentMessage: (input: {
    fromSessionId: string
    toSessionId: string
    content: string
  }) => Promise<void>
  /** Respond to a pending tool approval request. */
  respondToToolApproval: (response: ToolApprovalResponse) => Promise<void>
  /**
   * Load existing messages for a session from the backend. Used to hydrate
   * the message store when resuming a conversation so prior messages appear
   * immediately without waiting for the SDK to replay them.
   */
  loadMessages: (sessionId: string) => Promise<void>
}

/**
 * Tracks the running text delta accumulation for a single session.
 * While the assistant is streaming, individual `assistant_text_delta`
 * events are concatenated here instead of being stored as separate messages.
 * The accumulated text is exposed as a single synthetic delta in the
 * messages getter. When the final `assistant_message` arrives, it replaces
 * the accumulated delta and the buffer is cleared.
 */
interface DeltaBuffer {
  /** Concatenated text from all deltas received so far. */
  text: string
  /**
   * Index in the raw messages array where the synthetic delta should be
   * inserted. This is the position of the first delta we received for
   * this streaming turn — preserving chronological order relative to
   * tool_use_request, tool_result, etc.
   */
  insertionIndex: number
}

const MessageContext = createContext<MessageContextValue | null>(null)

export function useMessages(): MessageContextValue {
  const ctx = useContext(MessageContext)
  if (!ctx) {
    throw new Error('useMessages must be used within a MessageProvider')
  }
  return ctx
}

export function MessageProvider({ children }: { children: ReactNode }) {
  // Append-only mirror of main's MessageHistoryStore, keyed by session id.
  // Holds non-delta, non-transient messages — raw delta events are coalesced
  // into deltaBufferRef / thinkingBufferRef for efficient streaming rendering.
  const messagesRef = useRef(new Map<string, CapybaraMessage[]>())

  // Running delta buffer per session. Cleared when `assistant_message` arrives.
  const deltaBufferRef = useRef(new Map<string, DeltaBuffer>())

  // Running thinking delta buffer per session. Cleared alongside text deltas
  // when the final assistant_message arrives.
  const thinkingBufferRef = useRef(new Map<string, DeltaBuffer>())

  // Accumulated metadata per session, updated when `metadata_updated` arrives.
  const metadataRef = useRef(new Map<string, SessionMetadata>())

  // Number of raw events ingested per session, used to reconcile hydration
  // snapshots with the live stream. Incremented for every ingestMessage()
  // call regardless of message kind.
  const ingestedCountRef = useRef(new Map<string, number>())

  // Per-session hydration buffer. While a session is mid-hydration, live
  // events land here instead of being ingested, then are flushed in order
  // once the snapshot has been reconciled. A Map entry means "hydrating".
  const hydrationBufferRef = useRef(new Map<string, CapybaraMessage[]>())

  const [tick, setTick] = useState(0)

  const forceUpdate = useCallback(() => {
    setTick((t) => t + 1)
  }, [])

  // ---- Core ingest ---------------------------------------------------------
  //
  // Shared by the live onMessage listener and by loadMessages during
  // hydration. Mutates the ref maps directly; does NOT call forceUpdate —
  // the caller decides when to flush a re-render (once per live event, or
  // once after a whole hydration batch).

  const ingestMessage = useCallback((message: CapybaraMessage): void => {
    const msgMap = messagesRef.current
    const bufMap = deltaBufferRef.current
    const thinkBufMap = thinkingBufferRef.current
    const existing = msgMap.get(message.sessionId) ?? []

    // Always count the raw event, even if it's routed to a buffer rather
    // than the message list. This is what lets hydration reconcile against
    // the live stream.
    const counts = ingestedCountRef.current
    counts.set(message.sessionId, (counts.get(message.sessionId) ?? 0) + 1)

    if (message.kind === 'metadata_updated') {
      // Internal-only: update session metadata, do NOT add to messages.
      const metaMap = metadataRef.current
      const prev = metaMap.get(message.sessionId) ?? {}
      metaMap.set(message.sessionId, { ...prev, ...message.metadata })
      return
    }

    if (message.kind === 'assistant_text_delta') {
      const buf = bufMap.get(message.sessionId)
      if (buf) {
        buf.text += message.text
      } else {
        bufMap.set(message.sessionId, {
          text: message.text,
          insertionIndex: existing.length
        })
      }
      return
    }

    if (message.kind === 'thinking_delta') {
      const buf = thinkBufMap.get(message.sessionId)
      if (buf) {
        buf.text += message.text
      } else {
        thinkBufMap.set(message.sessionId, {
          text: message.text,
          insertionIndex: existing.length
        })
      }
      return
    }

    if (message.kind === 'assistant_message') {
      // Final message replaces the accumulated deltas. Clear both buffers.
      bufMap.delete(message.sessionId)
      thinkBufMap.delete(message.sessionId)
      msgMap.set(message.sessionId, [...existing, message])
      return
    }

    // All other message types append normally.
    msgMap.set(message.sessionId, [...existing, message])
  }, [])

  // ---- Bridge listeners ----------------------------------------------------

  useEffect(() => {
    const unsubMessage = window.sessionAPI.onMessage(
      (message: CapybaraMessage) => {
        // If a hydration is in flight for this session, buffer the event.
        // It will be replayed through ingestMessage once the snapshot has
        // been reconciled.
        const hydrating = hydrationBufferRef.current.get(message.sessionId)
        if (hydrating) {
          hydrating.push(message)
          return
        }
        ingestMessage(message)
        forceUpdate()
      }
    )

    const unsubToolApproval = window.sessionAPI.onToolApprovalRequest(
      (request: ToolApprovalRequest) => {
        // Surface tool approval requests as CapybaraMessages so the UI can
        // render them inline. The ToolUseRequest kind maps naturally.
        //
        // Note: tool_use_request messages also flow through the main-process
        // history store via the normal message channel, so we do NOT touch
        // ingestedCountRef here — this path exists to add UI affordances
        // (the `requiresApproval` flag) that the plain message channel
        // doesn't carry. If the same tool use arrives via both channels it
        // will produce a duplicate; that is an existing behaviour outside
        // the scope of the H4 fix.
        const message: CapybaraMessage = {
          kind: 'tool_use_request',
          sessionId: request.sessionId,
          toolUseId: request.toolUseId,
          toolName: request.toolName,
          input: request.input,
          requiresApproval: true
        }
        const map = messagesRef.current
        const existing = map.get(request.sessionId) ?? []
        map.set(request.sessionId, [...existing, message])
        forceUpdate()
      }
    )

    // Free per-session buffers when a session exits. Without this, the
    // renderer's maps grow for the lifetime of the app every time the user
    // creates and destroys sessions.
    const unsubExited = window.sessionAPI.onSessionExited(
      (sessionId: string) => {
        const hadEntry =
          messagesRef.current.delete(sessionId) ||
          deltaBufferRef.current.delete(sessionId) ||
          thinkingBufferRef.current.delete(sessionId) ||
          metadataRef.current.delete(sessionId) ||
          ingestedCountRef.current.delete(sessionId) ||
          hydrationBufferRef.current.delete(sessionId)
        if (hadEntry) forceUpdate()
      }
    )

    return () => {
      unsubMessage()
      unsubToolApproval()
      unsubExited()
    }
  }, [forceUpdate, ingestMessage])

  // ---- Public API ----------------------------------------------------------

  const messagesGetter = useCallback((sessionId: string): CapybaraMessage[] => {
    const raw = messagesRef.current.get(sessionId) ?? []
    const buf = deltaBufferRef.current.get(sessionId)
    const thinkBuf = thinkingBufferRef.current.get(sessionId)

    // No active streaming — return messages as-is (no deltas to inject).
    if (!buf && !thinkBuf) return raw

    // Collect synthetic messages to inject, sorted by insertionIndex.
    const synthetics: { msg: CapybaraMessage; insertionIndex: number }[] = []

    if (thinkBuf) {
      const syntheticThinking: ThinkingDelta = {
        kind: 'thinking_delta',
        sessionId,
        text: thinkBuf.text
      }
      synthetics.push({
        msg: syntheticThinking,
        insertionIndex: thinkBuf.insertionIndex
      })
    }

    if (buf) {
      const syntheticDelta: AssistantTextDelta = {
        kind: 'assistant_text_delta',
        sessionId,
        text: buf.text
      }
      synthetics.push({
        msg: syntheticDelta,
        insertionIndex: buf.insertionIndex
      })
    }

    // Sort by insertion index so thinking (which starts first) appears before text
    synthetics.sort((a, b) => a.insertionIndex - b.insertionIndex)

    const result: CapybaraMessage[] = []
    let synIdx = 0

    for (let i = 0; i < raw.length; i++) {
      // Insert any synthetics that belong at this position
      while (
        synIdx < synthetics.length &&
        synthetics[synIdx].insertionIndex <= i
      ) {
        result.push(synthetics[synIdx].msg)
        synIdx++
      }
      result.push(raw[i])
    }
    // Append remaining synthetics at the end
    while (synIdx < synthetics.length) {
      result.push(synthetics[synIdx].msg)
      synIdx++
    }

    return result
  }, [])

  const sessionMetadataGetter = useCallback(
    (sessionId: string): SessionMetadata | undefined => {
      return metadataRef.current.get(sessionId)
    },
    []
  )

  const sendMessage = useCallback(
    async (sessionId: string, text: string): Promise<void> => {
      // Inject a local user message so it appears immediately in the UI.
      // The backend does not echo user messages back as CapybaraMessage events.
      const userMsg: UserMessage = {
        kind: 'user_message',
        sessionId,
        text,
        timestamp: Date.now()
      }
      const map = messagesRef.current
      const existing = map.get(sessionId) ?? []
      map.set(sessionId, [...existing, userMsg])
      forceUpdate()

      await window.sessionAPI.sendMessage(sessionId, text)
    },
    [forceUpdate]
  )

  const sendInterAgentMessage = useCallback(
    async (input: {
      fromSessionId: string
      toSessionId: string
      content: string
    }): Promise<void> => {
      await window.sessionAPI.sendInterAgentMessage(input)
    },
    []
  )

  const respondToToolApproval = useCallback(
    async (response: ToolApprovalResponse): Promise<void> => {
      await window.sessionAPI.respondToToolApproval(response)
    },
    []
  )

  const loadMessages = useCallback(
    async (sessionId: string): Promise<void> => {
      // Guard against concurrent hydrations for the same session.
      if (hydrationBufferRef.current.has(sessionId)) return

      // Begin buffering live events for this session. From this point until
      // reconciliation completes, onMessage pushes into this array instead
      // of calling ingestMessage directly.
      hydrationBufferRef.current.set(sessionId, [])

      let fetched: CapybaraMessage[]
      try {
        fetched = await window.sessionAPI.getMessages(sessionId)
      } catch (err) {
        // Release the buffer so future attempts can proceed. Any events
        // captured while hydrating are discarded — they'll be fetched on
        // the next hydration attempt.
        hydrationBufferRef.current.delete(sessionId)
        throw err
      }

      const ingested = ingestedCountRef.current.get(sessionId) ?? 0

      // Replay the snapshot's suffix through the normal ingest path. If
      // live events already carried us past the snapshot, there's nothing
      // to replay.
      if (fetched.length > ingested) {
        for (let i = ingested; i < fetched.length; i++) {
          ingestMessage(fetched[i])
        }
      }

      // Flush any events that arrived during the fetch window. They are
      // strictly newer than anything in the snapshot because onMessage
      // delivers in arrival order and main emits only after appending.
      const buffered = hydrationBufferRef.current.get(sessionId) ?? []
      hydrationBufferRef.current.delete(sessionId)
      for (const msg of buffered) {
        ingestMessage(msg)
      }

      forceUpdate()
    },
    [forceUpdate, ingestMessage]
  )

  // `tick` is included so the context value identity changes whenever messages
  // are added (via forceUpdate). Without it, all three callbacks are stable
  // refs and the memoised value never changes — consumers never re-render.
  const value = useMemo<MessageContextValue>(
    () => ({
      messages: messagesGetter,
      sessionMetadata: sessionMetadataGetter,
      sendMessage,
      sendInterAgentMessage,
      respondToToolApproval,
      loadMessages
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      messagesGetter,
      sessionMetadataGetter,
      sendMessage,
      sendInterAgentMessage,
      respondToToolApproval,
      loadMessages,
      tick
    ]
  )

  return (
    <MessageContext.Provider value={value}>{children}</MessageContext.Provider>
  )
}
