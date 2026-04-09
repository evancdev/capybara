import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Session } from '@/shared/types/session'
import { useError } from '@/renderer/context/ErrorContext'
import { InlineRenameInput } from '@/renderer/ui'
import styles from '@/renderer/styles/ConversationHistory.module.css'

const NAMES_STORAGE_KEY = 'capybara-conversation-names'
const HIDDEN_STORAGE_KEY = 'capybara-hidden-conversations'

function loadHiddenIds(): Set<string> {
  try {
    const stored = localStorage.getItem(HIDDEN_STORAGE_KEY)
    if (!stored) return new Set()
    return new Set(JSON.parse(stored) as string[])
  } catch {
    return new Set()
  }
}

function saveHiddenIds(ids: Set<string>): void {
  localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...ids]))
}

function loadCustomNames(): Record<string, string> {
  try {
    const stored = localStorage.getItem(NAMES_STORAGE_KEY)
    if (!stored) return {}
    return JSON.parse(stored) as Record<string, string>
  } catch {
    return {}
  }
}

function saveCustomName(
  currentNames: Record<string, string>,
  id: string,
  name: string
): void {
  const updated = { ...currentNames, [id]: name }
  localStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(updated))
}

interface ConversationHistoryProps {
  projectPath: string
  onResume: (conversationId: string) => void
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function ConversationHistory({
  projectPath,
  onResume
}: ConversationHistoryProps) {
  const { setError } = useError()
  const [conversations, setConversations] = useState<Session[]>([])
  const [customNames, setCustomNames] =
    useState<Record<string, string>>(loadCustomNames)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHiddenIds)

  // Force re-render every 60s so relative timestamps stay fresh.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!expanded) return
    const id = setInterval(() => {
      setTick((t) => t + 1)
    }, 60_000)
    return () => {
      clearInterval(id)
    }
  }, [expanded])

  // Pre-compute formatted "x ago" strings once per render tick so the map
  // body stays a pure lookup instead of re-running Date arithmetic per row.
  const formattedTimes = useMemo(
    () =>
      new Map(
        conversations.map((c) => [
          c.id,
          formatTimeAgo(c.lastActive ?? c.createdAt)
        ])
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is a recompute trigger, not a read
    [conversations, tick]
  )

  const loadConversations = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.sessionAPI.listConversations(projectPath)
      setConversations(result)
    } catch (err) {
      setConversations([])
      const message =
        err instanceof Error ? err.message : 'Failed to load conversations'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [projectPath, setError])

  useEffect(() => {
    if (expanded) {
      void loadConversations()
    }
  }, [expanded, loadConversations])

  useEffect(() => {
    setExpanded(false)
    setConversations([])
  }, [projectPath])

  const handleRemove = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      saveHiddenIds(next)
      return next
    })
  }, [])

  const handleRename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim()
      // Client-side validation mirrors backend zod schema (1..200).
      // Backend is authoritative; this is UX only.
      if (!trimmed || trimmed.length > 200) {
        setEditingId(null)
        return
      }

      // Snapshot prior custom name so we can revert on failure.
      const hadPrevious = Object.prototype.hasOwnProperty.call(customNames, id)
      const previous = customNames[id]

      // Optimistic update for snappy UX.
      setCustomNames((prev) => {
        const next = { ...prev, [id]: trimmed }
        saveCustomName(next, id, trimmed)
        return next
      })
      setEditingId(null)

      try {
        await window.sessionAPI.renameConversation({
          conversationId: id,
          title: trimmed,
          cwd: projectPath
        })
      } catch (err) {
        // Revert optimistic update.
        setCustomNames((prev) => {
          const next: Record<string, string> = {}
          for (const key of Object.keys(prev)) {
            if (key === id && !hadPrevious) continue
            next[key] = key === id ? previous : prev[key]
          }
          if (hadPrevious && !(id in next)) {
            next[id] = previous
          }
          localStorage.setItem(NAMES_STORAGE_KEY, JSON.stringify(next))
          return next
        })
        const message =
          err instanceof Error ? err.message : 'Failed to rename conversation'
        setError(message)
      }
    },
    [customNames, projectPath, setError]
  )

  return (
    <div className={styles.root}>
      <button
        className={styles.toggle}
        onClick={() => {
          setExpanded((prev) => !prev)
        }}
        aria-expanded={expanded}
      >
        <span className={styles.chevron}>{expanded ? '\u25BE' : '\u25B8'}</span>
        <span>Recent Conversations</span>
      </button>
      {expanded ? (
        <div className={styles.list}>
          {loading ? (
            <div className={styles.empty}>Loading...</div>
          ) : conversations.length === 0 ? (
            <div className={styles.empty}>No past conversations</div>
          ) : (
            conversations
              .filter((c) => !hiddenIds.has(c.id))
              .map((conv) => {
                const displayName = customNames[conv.id] ?? conv.title

                if (editingId === conv.id) {
                  return (
                    <div key={conv.id} className={styles.item}>
                      <InlineRenameInput
                        initialValue={displayName}
                        maxLength={200}
                        onCommit={(name) => {
                          void handleRename(conv.id, name)
                        }}
                        onCancel={() => {
                          setEditingId(null)
                        }}
                      />
                    </div>
                  )
                }

                return (
                  <div key={conv.id} className={styles.item}>
                    <button
                      className={styles.itemContent}
                      onClick={() => {
                        onResume(conv.id)
                      }}
                      title={displayName}
                    >
                      <span className={styles.title}>{displayName}</span>
                      <span className={styles.time}>
                        {formattedTimes.get(conv.id)}
                      </span>
                    </button>
                    <button
                      className={styles.renameBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingId(conv.id)
                      }}
                      aria-label="Rename conversation"
                      title="Rename"
                    >
                      &#9998;
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemove(conv.id)
                      }}
                      aria-label="Remove conversation"
                      title="Remove"
                    >
                      &#10005;
                    </button>
                  </div>
                )
              })
          )}
        </div>
      ) : null}
    </div>
  )
}
