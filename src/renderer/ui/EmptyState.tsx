import { memo } from 'react'

interface EmptyStateProps {
  title: string
  text: string
  actionLabel?: string
  onAction?: () => void
}

export const EmptyState = memo(function EmptyState({
  title,
  text,
  actionLabel,
  onAction
}: EmptyStateProps) {
  return (
    <div className="empty-state" style={{ flex: 1 }}>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-text">{text}</div>
      {actionLabel && onAction ? (
        <button className="empty-state-btn" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
})
