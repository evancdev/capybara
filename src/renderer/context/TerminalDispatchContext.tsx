import { createContext, useContext, useCallback, useRef, useMemo } from 'react'
import type { ReactNode } from 'react'

interface TerminalDispatchContextValue {
  registerTerminalHandler: (
    sessionId: string,
    callback: (data: string) => void
  ) => void
  unregisterTerminalHandler: (sessionId: string) => void
  dispatchTerminalOutput: (sessionId: string, data: string) => void
}

const TerminalDispatchContext =
  createContext<TerminalDispatchContextValue | null>(null)

export function useTerminalDispatch(): TerminalDispatchContextValue {
  const ctx = useContext(TerminalDispatchContext)
  if (!ctx) {
    throw new Error(
      'useTerminalDispatch must be used within a TerminalDispatchProvider'
    )
  }
  return ctx
}

export function TerminalDispatchProvider({
  children
}: {
  children: ReactNode
}) {
  const handlers = useRef(new Map<string, (data: string) => void>())

  const registerTerminalHandler = useCallback(
    (sessionId: string, callback: (data: string) => void) => {
      handlers.current.set(sessionId, callback)
    },
    []
  )

  const unregisterTerminalHandler = useCallback((sessionId: string) => {
    handlers.current.delete(sessionId)
  }, [])

  const dispatchTerminalOutput = useCallback(
    (sessionId: string, data: string) => {
      const handler = handlers.current.get(sessionId)
      if (handler) {
        handler(data)
      }
    },
    []
  )

  const value = useMemo<TerminalDispatchContextValue>(
    () => ({
      registerTerminalHandler,
      unregisterTerminalHandler,
      dispatchTerminalOutput
    }),
    [registerTerminalHandler, unregisterTerminalHandler, dispatchTerminalOutput]
  )

  return (
    <TerminalDispatchContext.Provider value={value}>
      {children}
    </TerminalDispatchContext.Provider>
  )
}
