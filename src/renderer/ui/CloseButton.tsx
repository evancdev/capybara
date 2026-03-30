import { memo } from 'react'

interface CloseButtonProps {
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}

export const CloseButton = memo(function CloseButton({
  label,
  onClick
}: CloseButtonProps) {
  return (
    <button className="tab-close" aria-label={label} onClick={onClick}>
      &times;
    </button>
  )
})
