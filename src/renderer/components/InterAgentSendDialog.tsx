import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '@/renderer/context/SessionContext'
import { useMessages } from '@/renderer/context/MessageContext'
import { useEscapeKey } from '@/renderer/hooks/useEscapeKey'
import styles from './InterAgentSendDialog.module.css'

interface InterAgentSendDialogProps {
  onClose: () => void
  fromSessionId: string
}

/** Short fallback id used when no custom name has been set for a session. */
function shortId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

/**
 * Dialog for sending a one-shot message from the active session to another
 * session in the same project. The dialog owns its own form state; on submit
 * it forwards to `sendInterAgentMessage` from MessageContext (which in turn
 * invokes the preload bridge). No optimistic UI — the delivered message
 * comes back through the existing SESSION_MESSAGE pipeline.
 *
 * The parent conditionally mounts this component on open, so initial state
 * is naturally fresh on each show — no reset effect required.
 */
export function InterAgentSendDialog({
  onClose,
  fromSessionId
}: InterAgentSendDialogProps) {
  const { projects, activeProjectPath, sessionNames } = useSession()
  const { sendInterAgentMessage } = useMessages()

  // Candidate targets: sessions in the active project, minus the sender.
  // Resolving here (not from a memo outside the dialog) keeps the dialog
  // self-contained and avoids any drift between the gate in MessagePanel
  // (which decides whether to render the trigger) and the dialog itself.
  const candidates = useMemo(() => {
    if (activeProjectPath === null) return []
    const project = projects.get(activeProjectPath)
    if (!project) return []
    return project.sessions.filter((s) => s.id !== fromSessionId)
  }, [projects, activeProjectPath, fromSessionId])

  // Default-select the first candidate on mount via a lazy initializer so
  // the user can just type and hit Send. Since the parent mounts us fresh
  // on each open, this runs exactly once per open.
  const [toSessionId, setToSessionId] = useState(() =>
    candidates.length > 0 ? candidates[0].id : ''
  )
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus the textarea on mount (parent mounts us fresh on each open).
  useEffect(() => {
    // Defer to next tick so the textarea is mounted when we focus it.
    const handle = window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(handle)
    }
  }, [])

  // Escape-to-close. The hook installs a single window listener and cleans
  // up on unmount; the parent only mounts us while open, so no open-gate.
  const handleEscape = useCallback(
    (e: KeyboardEvent): void => {
      if (isSending) return
      e.preventDefault()
      onClose()
    },
    [isSending, onClose]
  )
  useEscapeKey(handleEscape)

  const trimmedContent = content.trim()
  const canSend =
    !isSending && toSessionId !== '' && trimmedContent.length > 0

  const handleSend = useCallback(async () => {
    if (!canSend) return
    setIsSending(true)
    setError(null)
    try {
      await sendInterAgentMessage({
        fromSessionId,
        toSessionId,
        content: trimmedContent
      })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setIsSending(false)
    }
  }, [
    canSend,
    sendInterAgentMessage,
    fromSessionId,
    toSessionId,
    trimmedContent,
    onClose
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter submits; plain Enter inserts a newline (matching
      // typical multi-line textarea ergonomics, distinct from the main
      // prompt where Enter sends).
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend]
  )

  // Note: parent is expected to gate on "project has >= 2 sessions" before
  // opening, so in practice `candidates` should never be empty here. The
  // friendly empty-state below is a defensive fallback in case the sibling
  // session exits between the gate check and the render.
  const hasCandidates = candidates.length > 0

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="inter-agent-dialog-title"
      onClick={(e) => {
        // Click on the backdrop (not the panel itself) closes the dialog.
        if (e.target === e.currentTarget && !isSending) onClose()
      }}
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 id="inter-agent-dialog-title" className={styles.title}>
            Send message to another session
          </h2>
        </div>

        {hasCandidates ? (
          <div className={styles.body}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>To</span>
              <select
                className={styles.select}
                value={toSessionId}
                onChange={(e) => {
                  setToSessionId(e.target.value)
                }}
                disabled={isSending}
              >
                {candidates.map((s) => {
                  const name = sessionNames.get(s.id) ?? shortId(s.id)
                  return (
                    <option key={s.id} value={s.id}>
                      {name}
                    </option>
                  )
                })}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Message</span>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                disabled={isSending}
                rows={6}
                aria-label="Inter-agent message content"
              />
            </label>

            {error !== null ? (
              <div className={styles.error} role="alert">
                {error}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.emptyState}>
              No other sessions to message.
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={onClose}
            disabled={isSending}
          >
            Cancel
          </button>
          {hasCandidates ? (
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => void handleSend()}
              disabled={!canSend}
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
