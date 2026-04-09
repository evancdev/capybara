import { useEffect } from 'react'

/**
 * Listen for the Escape key on the window and invoke the handler. The handler
 * receives the raw event so callers can decide whether to `preventDefault` or
 * gate on ref-backed state.
 */
export function useEscapeKey(handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') handler(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handler])
}
