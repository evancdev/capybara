import { useState, useRef, useCallback, useEffect } from 'react'

interface InlineRenameInputProps {
  initialValue: string
  onCommit: (name: string) => void
  onCancel: () => void
  maxLength?: number
}

export function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
  maxLength = 40
}: InlineRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)
  const committedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    const trimmed = value.trim()
    if (trimmed && trimmed !== initialValue) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }, [value, initialValue, onCommit, onCancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        committedRef.current = true
        onCancel()
      }
    },
    [commit, onCancel]
  )

  return (
    <input
      ref={inputRef}
      className="agent-name-input"
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
      }}
      onKeyDown={handleKeyDown}
      onBlur={commit}
      maxLength={maxLength}
    />
  )
}
