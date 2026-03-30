import { useState, useEffect, useCallback, useReducer } from 'react'
import type { Conversation } from '@/shared/types/session'
import { useError } from '@/renderer/context/ErrorContext'
import { InlineRenameInput } from '@/renderer/ui'
import styles from '@/renderer/styles/ConversationHistory.module.css'

const NAMES_STORAGE_KEY = 'capybara-conversation-names'

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
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [customNames, setCustomNames] =
    useState<Record<string, string>>(loadCustomNames)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Force re-render every 60s so relative timestamps stay fresh
  const [, forceTick] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    if (!expanded) return
    const id = setInterval(forceTick, 60_000)
    return () => {
      clearInterval(id)
    }
  }, [expanded])

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

  const handleRename = useCallback((id: string, name: string) => {
    setCustomNames((prev) => {
      const next = { ...prev, [id]: name }
      saveCustomName(next, id, name)
      return next
    })
    setEditingId(null)
  }, [])

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
            conversations.map((conv) => {
              const displayName = customNames[conv.id] ?? conv.title

              if (editingId === conv.id) {
                return (
                  <div key={conv.id} className={styles.item}>
                    <InlineRenameInput
                      initialValue={displayName}
                      onCommit={(name) => {
                        handleRename(conv.id, name)
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
                      {formatTimeAgo(conv.lastActive)}
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
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
