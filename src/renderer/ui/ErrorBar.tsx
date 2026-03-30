import { memo } from 'react'

interface ErrorBarProps {
  message: string
  onDismiss: () => void
}

export const ErrorBar = memo(function ErrorBar({
  message,
  onDismiss
}: ErrorBarProps) {
  return (
    <div className="error-bar" role="alert">
      <span>{message}</span>
      <button className="error-bar-dismiss" onClick={onDismiss}>
        &times;
      </button>
    </div>
  )
})
