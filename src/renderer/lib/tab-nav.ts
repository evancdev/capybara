import type { KeyboardEvent } from 'react'

/**
 * Move focus between sibling `[role="tab"]` elements when arrow keys are
 * pressed. Call from a tab element's `onKeyDown` handler. Returns true if the
 * event was handled so the caller can early-return.
 */
export function handleTabArrowNav(
  e: KeyboardEvent<HTMLElement>,
  orientation: 'horizontal' | 'vertical'
): boolean {
  const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  if (e.key !== prevKey && e.key !== nextKey) return false

  e.preventDefault()
  const tabs =
    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
      '[role="tab"]'
    )
  if (!tabs || tabs.length === 0) return true

  const currentIdx = Array.from(tabs).indexOf(e.currentTarget)
  const nextIdx =
    e.key === nextKey
      ? (currentIdx + 1) % tabs.length
      : (currentIdx - 1 + tabs.length) % tabs.length
  tabs[nextIdx].focus()
  return true
}
