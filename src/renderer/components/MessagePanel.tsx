import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type {
  CapybaraMessage,
  ToolApprovalResponse
} from '@/shared/types/messages'
import { CYCLING_PERMISSION_MODES } from '@/shared/types/session'
import type { Session, SessionMetadata } from '@/shared/types/session'
import { findSlashCommand, parseSlashInput } from '@/shared/types/commands'
import { MessageBubble } from '@/renderer/components/MessageBubble'
import { ModeSelector } from '@/renderer/components/ModeSelector'
import { SlashCommandMenu } from '@/renderer/components/SlashCommandMenu'
import { filterSlashCommands } from '@/renderer/lib/slash-filter'
import { useEscapeKey } from '@/renderer/hooks/useEscapeKey'
import { useSpinner } from '@/renderer/hooks/useSpinner'
import { mergeMetadata } from '@/renderer/lib/metadata'
import { useSession } from '@/renderer/context/SessionContext'
import { useError } from '@/renderer/context/ErrorContext'
import { useKeyBindings } from '@/renderer/context/KeyBindingsContext'
import { matchesBinding } from '@/renderer/types/keybindings'
import styles from '@/renderer/styles/MessagePanel.module.css'

/**
 * Determine whether the session is in a "thinking" state based on the last
 * visible message. We consider the assistant to be thinking when the most
 * recent message is a `user_message` or `tool_result` — meaning we have sent
 * something and are waiting for the assistant to respond.
 */
function isThinkingState(messages: CapybaraMessage[]): boolean {
  if (messages.length === 0) return false

  // Walk backwards to find the last *visible* message kind.
  // Skip kinds that are invisible in the terminal aesthetic (usage_message,
  // metadata_updated, system init).
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    switch (msg.kind) {
      case 'usage_message':
      case 'metadata_updated':
      case 'tool_use_summary':
        continue
      case 'system_message':
        if (msg.messageType === 'init') continue
        return false
      case 'session_state':
        // session_state with requires_action means we're waiting for user
        if (msg.state === 'requires_action') return false
        // idle/running are invisible — keep searching
        continue
      case 'user_message':
      case 'tool_result':
        return true
      case 'thinking_delta':
      case 'tool_progress':
      case 'task_update':
        // These indicate the assistant is actively working — not "thinking"
        return false
      default:
        return false
    }
  }
  return false
}

/**
 * Determine whether the agent is actively running — i.e. the user has sent a
 * message and we have not yet received a final assistant response or an idle
 * session state. This is broader than `isThinkingState`: the agent is "running"
 * both while we're waiting for a response AND while we're receiving streamed
 * thinking/tool progress/task updates.
 */
function isAgentRunning(messages: CapybaraMessage[]): boolean {
  if (messages.length === 0) return false

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    switch (msg.kind) {
      // Invisible kinds — skip past them
      case 'usage_message':
      case 'metadata_updated':
      case 'tool_use_summary':
        continue
      case 'system_message':
        if (msg.messageType === 'init') continue
        return false
      case 'session_state':
        if (msg.state === 'requires_action') return false
        if (msg.state === 'idle') return false
        // 'running' is invisible — keep searching
        continue
      // Waiting for assistant
      case 'user_message':
      case 'tool_result':
        return true
      // Agent is actively working
      case 'thinking_delta':
      case 'tool_progress':
      case 'task_update':
      case 'tool_use_request':
        return true
      // Streaming text — agent is producing output
      case 'assistant_text_delta':
        return true
      // Final response — agent is done
      case 'assistant_message':
        return false
      default:
        return false
    }
  }
  return false
}

/**
 * Format elapsed seconds into a human-readable timer string.
 * Under 60s: "12s". 60s and above: "1m 23s".
 */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toString().padStart(2, '0')}s`
}

/**
 * Format a token count into a compact human-readable string.
 * e.g. 1800 -> "1.8k", 150 -> "0.2k"
 */
function formatTokenCount(n: number): string {
  return `${(n / 1000).toFixed(1)}k`
}

/**
 * Read the cumulative total tokens (input + output) from the most recent
 * usage_message. Each `usage_message.summary` is already cumulative across
 * the session, so walking backwards and taking the first one is O(k) where
 * k is the distance from the tail to the last usage — much cheaper than
 * summing every turn's usage on every render.
 */
function cumulativeTokens(messages: CapybaraMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.kind === 'usage_message') {
      return msg.summary.totalInputTokens + msg.summary.totalOutputTokens
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// ElapsedTimer — shows how long the current agent turn has been running
// ---------------------------------------------------------------------------

function ElapsedTimer({
  running,
  totalTokens
}: {
  running: boolean
  totalTokens: number
}) {
  // Elapsed seconds derived from a startedAt timestamp captured when
  // `running` flips true. The interval recomputes elapsed from the
  // timestamp (not by incrementing) so the value stays accurate even if
  // the tab is throttled. We avoid the "set state in effect" antipattern
  // by only writing state from inside the interval callback or cleanup.
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!running) {
      // Reset on cleanup of the previous run, not synchronously here.
      return () => {
        setElapsed(0)
      }
    }

    const startedAt = Date.now()
    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setElapsed(0)
    }
  }, [running])

  const showTimer = running && elapsed >= 1
  const showTokens = totalTokens > 0

  // Nothing to display
  if (!showTimer && !showTokens) return null

  // Build display string
  let display: string
  if (showTimer && showTokens) {
    display = `${formatElapsed(elapsed)} \u00b7 ${formatTokenCount(totalTokens)} tokens`
  } else if (showTimer) {
    display = formatElapsed(elapsed)
  } else {
    display = `${formatTokenCount(totalTokens)} tokens`
  }

  return (
    <div
      className={styles.elapsedTimer}
      aria-label={showTimer ? 'Elapsed time' : 'Token usage'}
    >
      {display}
    </div>
  )
}

function ThinkingIndicator() {
  const char = useSpinner()
  return (
    <div
      className={styles.thinkingIndicator}
      role="status"
      aria-label="Assistant is thinking"
    >
      <span className={styles.spinnerChar} aria-hidden="true">
        {char}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessagePanel — terminal-aesthetic message renderer
// ---------------------------------------------------------------------------

interface MessagePanelProps {
  sessionId: string
  messages: CapybaraMessage[]
  onRespondToToolApproval?: (response: ToolApprovalResponse) => void
  /** Send a user message to this session. Omit to hide the prompt. */
  onSendMessage?: (sessionId: string, text: string) => Promise<void>
  /** Working directory for this session, shown in the startup banner. */
  cwd?: string
  /**
   * Descriptor metadata captured at session creation. Passed separately from
   * liveMetadata so memo() can short-circuit on stable refs during streaming.
   */
  descriptorMetadata?: SessionMetadata
  /** Live metadata accumulated from `metadata_updated` events. */
  liveMetadata?: SessionMetadata
  /**
   * Session descriptor — passed in by SessionLayout from the SessionContext
   * store. Used for permission-mode cycling (Shift+Tab) and the ModeSelector.
   */
  session?: Session
}

/**
 * Threshold in px — if the user has scrolled more than this distance from the
 * bottom, we consider them "scrolled up" and show the new-messages indicator
 * instead of auto-scrolling.
 */
const AUTO_SCROLL_THRESHOLD = 60

/** Characters to type in the startup animation */
const STARTUP_COMMAND = '$ claude'

/** Delay per character in the typing animation (ms) */
const TYPING_DELAY_MIN = 50
const TYPING_DELAY_MAX = 80

/** Phases of the startup animation */
type StartupPhase = 'typing' | 'banner' | 'done'

/** Delay after banner appears before showing the prompt indicator (ms) */
const BANNER_DISPLAY_MS = 1500

/**
 * Homedir reported by main via USER_INFO at startup. Module-level so the
 * one-shot subscription survives component remounts and any MessagePanel
 * instance can shorten paths without threading props.
 */
let knownHomedir: string | null = null
window.sessionAPI.onUserInfo((info) => {
  knownHomedir = info.homedir
})

/** Shorten a path by replacing the user's home directory prefix with ~. */
function shortenCwd(cwd: string): string {
  if (!knownHomedir) return cwd
  // Case-insensitive prefix match for Windows; exact elsewhere.
  const isWindows = /^[A-Za-z]:\\/.test(knownHomedir)
  const hit = isWindows
    ? cwd.toLowerCase().startsWith(knownHomedir.toLowerCase())
    : cwd.startsWith(knownHomedir)
  return hit ? `~${cwd.slice(knownHomedir.length)}` : cwd
}

// ---------------------------------------------------------------------------
// StartupAnimation — shown when MessagePanel mounts with 0 messages
// ---------------------------------------------------------------------------

interface StartupAnimationProps {
  hasMessages: boolean
  cwd?: string
  metadata?: SessionMetadata
}

function StartupAnimation({
  hasMessages,
  cwd,
  metadata
}: StartupAnimationProps) {
  const [typedChars, setTypedChars] = useState(0)
  const [animPhase, setAnimPhase] = useState<StartupPhase>('typing')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Derive effective phase: skip animation when messages are already present
  const phase: StartupPhase = hasMessages ? 'done' : animPhase

  // Typing effect
  useEffect(() => {
    if (phase !== 'typing') return

    if (typedChars >= STARTUP_COMMAND.length) {
      // Typing done — move to banner phase
      timerRef.current = setTimeout(() => {
        setAnimPhase('banner')
      }, 300)
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      }
    }

    const delay =
      TYPING_DELAY_MIN + Math.random() * (TYPING_DELAY_MAX - TYPING_DELAY_MIN)
    timerRef.current = setTimeout(() => {
      setTypedChars((c) => c + 1)
    }, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [typedChars, phase])

  // Auto-transition from banner to done after delay
  useEffect(() => {
    if (phase !== 'banner') return

    timerRef.current = setTimeout(() => {
      setAnimPhase('done')
    }, BANNER_DISPLAY_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [phase])

  const displayCwd = cwd ? shortenCwd(cwd) : undefined
  const bannerVersion = metadata?.claudeCodeVersion ?? undefined
  const bannerModel = metadata?.model ?? undefined
  const bannerContext = metadata?.contextWindow ?? undefined
  const bannerPlan = metadata?.plan ?? undefined

  // Build the model detail line: "model (context) . plan"
  // Show whatever parts are available; omit what's missing.
  const modelParts: string[] = []
  if (bannerModel) {
    modelParts.push(
      bannerContext ? `${bannerModel} (${bannerContext})` : bannerModel
    )
  }
  if (bannerPlan) {
    modelParts.push(bannerPlan)
  }
  const modelLine =
    modelParts.length > 0 ? modelParts.join(' \u00b7 ') : undefined

  // During animation phases, show the animated version
  const isAnimating = phase !== 'done'

  return (
    <div
      className={isAnimating ? styles.startupPanel : styles.startupBanner}
      aria-live="polite"
      aria-label={isAnimating ? 'Initializing session' : 'Session banner'}
    >
      <div className={styles.startupCommand}>
        <span className={styles.startupPrompt} aria-hidden="true">
          {'>'}
        </span>
        <span>
          {isAnimating ? STARTUP_COMMAND.slice(0, typedChars) : STARTUP_COMMAND}
        </span>
        {phase === 'typing' && (
          <span className={styles.startupCursor} aria-hidden="true" />
        )}
      </div>
      {(phase === 'banner' || phase === 'done') && (
        <div
          className={styles.bannerBlock}
          aria-label="Claude Code greeting banner"
          style={phase === 'done' ? { animation: 'none' } : undefined}
        >
          <div className={styles.bannerTitleRow}>
            <span className={styles.bannerIcon} aria-hidden="true">
              &#x1F9AB;
            </span>
            <span className={styles.bannerSpacer}> </span>
            <span className={styles.bannerTitle}>Claude Code</span>
            {bannerVersion !== undefined && (
              <span className={styles.bannerVersion}> {bannerVersion}</span>
            )}
          </div>
          {modelLine !== undefined && (
            <div className={styles.bannerDetailRow}>
              <span className={styles.bannerIndent} aria-hidden="true">
                {'    '}
              </span>
              {modelLine}
            </div>
          )}
          {displayCwd !== undefined && (
            <div className={styles.bannerDetailRow}>
              <span className={styles.bannerIndent} aria-hidden="true">
                {'    '}
              </span>
              {displayCwd}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessagePanel
// ---------------------------------------------------------------------------

export const MessagePanel = memo(function MessagePanel({
  sessionId,
  messages,
  onRespondToToolApproval,
  onSendMessage,
  cwd,
  descriptorMetadata,
  liveMetadata,
  session
}: MessagePanelProps) {
  const metadata = useMemo(
    () => mergeMetadata(descriptorMetadata, liveMetadata),
    [descriptorMetadata, liveMetadata]
  )
  const { setSessionPermissionMode, runSessionCommand } = useSession()
  const { setError } = useError()
  const { bindings } = useKeyBindings()

  // Keep mode in a ref for the Shift+Tab handler without forcing the
  // keyDown callback to re-create on every render. Falls back to 'default'
  // when no session prop is provided (e.g. some unit tests).
  const permissionModeRef = useRef(session?.permissionMode ?? 'default')
  permissionModeRef.current = session?.permissionMode ?? 'default'
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const [composeText, setComposeText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const prevMessageCountRef = useRef(messages.length)

  // ---- Slash-command menu state -------------------------------------------
  // The menu is open whenever the user is typing a single-line slash command
  // and has not explicitly dismissed it via Escape. The dismissed flag is
  // cleared whenever composeText resets to empty (or no longer starts with /)
  // so retyping `/` reopens.
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [menuSelectedIndex, setMenuSelectedIndex] = useState(0)

  const menuFilter = composeText.startsWith('/')
    ? composeText.slice(1)
    : ''
  const menuOpen =
    !menuDismissed &&
    composeText.startsWith('/') &&
    !composeText.includes('\n')
  const menuMatches = useMemo(
    () => filterSlashCommands(menuFilter),
    [menuFilter]
  )

  // ---- Escape-to-abort ------------------------------------------------------

  const running = useMemo(() => isAgentRunning(messages), [messages])
  const runningRef = useRef(false)
  runningRef.current = running

  const handleEscape = useCallback(
    (e: KeyboardEvent): void => {
      if (!runningRef.current) return
      e.preventDefault()
      window.sessionAPI.stopResponse(sessionId).catch((err: unknown) => {
        console.error('[MessagePanel]', 'stopResponse failed', err)
      })
    },
    [sessionId]
  )
  useEscapeKey(handleEscape)

  // ---- Auto-focus the input on mount --------------------------------------

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // ---- Scroll position tracking -------------------------------------------

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsUserScrolledUp(distanceFromBottom > AUTO_SCROLL_THRESHOLD)
  }, [])

  // ---- Auto-scroll on new messages ----------------------------------------

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const hasNewMessages = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length

    if (hasNewMessages && !isUserScrolledUp) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, isUserScrolledUp])

  // ---- Scroll-to-bottom action --------------------------------------------

  const handleScrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setIsUserScrolledUp(false)
  }, [])

  // ---- Slash command plumbing ---------------------------------------------

  /**
   * Try to handle `text` as a slash command. Returns true if handled (either
   * dispatched or surfaced as an error), false if the caller should continue
   * with normal message sending. All kept slash commands are main-scoped, so
   * the renderer only routes via runSessionCommand and shows an error for
   * anything else.
   */
  const handleSlashCommand = useCallback(
    async (text: string): Promise<boolean> => {
      const parsed = parseSlashInput(text)
      if (parsed === null) return false

      const spec = findSlashCommand(parsed.name)
      if (spec?.scope === 'main') {
        await runSessionCommand(sessionId, parsed.name, parsed.args)
        return true
      }

      setError(`/${parsed.name} — unknown command`)
      return true
    },
    [sessionId, runSessionCommand, setError]
  )

  // ---- Submit handler -----------------------------------------------------

  const handleSubmit = useCallback(async () => {
    const trimmed = composeText.trim()
    if (!trimmed || isSending) return

    setIsSending(true)
    try {
      // Slash commands bypass the SDK entirely. Always clear the compose
      // line after dispatch, even on error, so the user isn't stuck with
      // a bad command sitting in the textarea.
      if (trimmed.startsWith('/')) {
        try {
          await handleSlashCommand(trimmed)
        } finally {
          setComposeText('')
          setMenuDismissed(false)
          setMenuSelectedIndex(0)
          const el = inputRef.current
          if (el) {
            el.style.height = 'auto'
            el.style.overflowY = 'hidden'
          }
        }
        return
      }

      if (!onSendMessage) return
      await onSendMessage(sessionId, trimmed)
      setComposeText('')
      setMenuDismissed(false)
      setMenuSelectedIndex(0)
      // Reset textarea height after clearing text
      const el = inputRef.current
      if (el) {
        el.style.height = 'auto'
        el.style.overflowY = 'hidden'
      }
    } finally {
      setIsSending(false)
      inputRef.current?.focus()
    }
  }, [composeText, onSendMessage, isSending, sessionId, handleSlashCommand])

  const acceptHighlightedCommand = useCallback(
    (name: string) => {
      const next = `/${name} `
      setComposeText(next)
      setMenuDismissed(true)
      setMenuSelectedIndex(0)
      // Restore focus + caret at end of the new value. Use requestAnimationFrame
      // so React has flushed the value first.
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(next.length, next.length)
        // Resize after value change.
        el.style.height = 'auto'
        const maxHeight = 150
        const clamped = Math.min(el.scrollHeight, maxHeight)
        el.style.height = `${clamped}px`
        el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
      })
    },
    []
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Menu key handling — only when the menu is visible.
      if (menuOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          if (menuMatches.length === 0) return
          setMenuSelectedIndex(
            (idx) => (idx + 1) % menuMatches.length
          )
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          if (menuMatches.length === 0) return
          setMenuSelectedIndex(
            (idx) => (idx - 1 + menuMatches.length) % menuMatches.length
          )
          return
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          const target = menuMatches[menuSelectedIndex] ?? menuMatches[0]
          acceptHighlightedCommand(target.name)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setMenuDismissed(true)
          return
        }
        // Enter falls through to the normal submit path below — the spec
        // says Enter submits as-is rather than auto-completing.
      }

      // Shift+Tab cycles permission mode. Textarea-scoped on purpose — a
      // global listener would break normal focus traversal everywhere else.
      if (matchesBinding(e.nativeEvent, bindings.cycleMode)) {
        e.preventDefault()
        const current = permissionModeRef.current
        const idx = CYCLING_PERMISSION_MODES.indexOf(current)
        // If the current mode is outside the cycle (bypass/dontAsk), start
        // the cycle from the beginning rather than leaving the user stuck.
        const nextIdx = idx === -1 ? 0 : (idx + 1) % CYCLING_PERMISSION_MODES.length
        const next = CYCLING_PERMISSION_MODES[nextIdx]
        void setSessionPermissionMode(sessionId, next)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [
      handleSubmit,
      bindings.cycleMode,
      setSessionPermissionMode,
      sessionId,
      menuOpen,
      menuMatches,
      menuSelectedIndex,
      acceptHighlightedCommand
    ]
  )

  /** Resize the textarea to fit its content, up to a max height. */
  const resizeTextarea = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 150
    const clamped = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${clamped}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  const handleComposeChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value
      setComposeText(next)
      // Reset menu selection on every filter change.
      setMenuSelectedIndex(0)
      // Clear the dismissed flag so the next `/` re-opens the menu. We clear
      // it when the value becomes empty or doesn't start with `/` — this
      // catches both "user deleted everything" and "user typed something else".
      if (!next.startsWith('/') || next === '') {
        setMenuDismissed(false)
      }
      // Schedule resize after React updates the textarea value
      requestAnimationFrame(resizeTextarea)
    },
    [resizeTextarea]
  )

  const handleMenuDismiss = useCallback(() => {
    setMenuDismissed(true)
  }, [])

  // ---- Terminal-style prompt area -----------------------------------------

  const currentMode = session?.permissionMode ?? 'default'

  const promptArea = onSendMessage ? (
    <div className={styles.promptArea}>
      <SlashCommandMenu
        open={menuOpen}
        matches={menuMatches}
        selectedIndex={menuSelectedIndex}
        onSelect={acceptHighlightedCommand}
        onDismiss={handleMenuDismiss}
      />
      <div className={styles.promptInputRow}>
        <span className={styles.promptSymbol} aria-hidden="true">
          {'>'}
        </span>
        <textarea
          ref={inputRef}
          className={styles.promptInput}
          value={composeText}
          onChange={handleComposeChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={isSending}
          rows={1}
          aria-label="Message input"
        />
      </div>
      {session !== undefined && (
        <div className={styles.promptModeRow}>
          <ModeSelector sessionId={sessionId} currentMode={currentMode} />
        </div>
      )}
    </div>
  ) : null

  // ---- Render — banner is always at top, messages flow below ---------------

  const hasMessages = messages.length > 0
  const thinking = useMemo(() => isThinkingState(messages), [messages])
  const totalTokens = useMemo(() => cumulativeTokens(messages), [messages])

  return (
    <div className={styles.panel} data-session-id={sessionId}>
      <div
        ref={scrollRef}
        className={styles.scrollContainer}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Session messages"
      >
        <StartupAnimation
          hasMessages={hasMessages}
          cwd={cwd}
          metadata={metadata}
        />
        {hasMessages ? (
          <div className={styles.messagesList}>
            {messages.map((msg, idx) => (
              <MessageBubble
                key={messageKey(msg, idx)}
                message={msg}
                onRespondToToolApproval={onRespondToToolApproval}
              />
            ))}
          </div>
        ) : null}
        {thinking ? <ThinkingIndicator /> : null}
      </div>
      {isUserScrolledUp ? (
        <button
          className={styles.scrollIndicator}
          onClick={handleScrollToBottom}
          aria-label="Scroll to see new messages"
        >
          Scroll to see new messages
        </button>
      ) : null}
      <ElapsedTimer running={running} totalTokens={totalTokens} />
      {promptArea}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Stable key generation
// ---------------------------------------------------------------------------

function messageKey(msg: CapybaraMessage, idx: number): string {
  switch (msg.kind) {
    case 'tool_use_request':
      return `tur-${msg.toolUseId}`
    case 'tool_result':
      return `tr-${msg.toolUseId}`
    case 'tool_progress':
      return `tp-${msg.toolUseId}-${idx}`
    case 'tool_use_summary':
      return `tus-${idx}`
    case 'assistant_message':
      return `am-${msg.timestamp}-${idx}`
    case 'inter_agent_message':
      return `ia-${msg.fromSessionId}-${msg.timestamp}`
    case 'user_message':
      return `um-${msg.timestamp}-${idx}`
    case 'task_update':
      return `task-${msg.taskId}-${msg.status}`
    default:
      return `${msg.kind}-${idx}`
  }
}
