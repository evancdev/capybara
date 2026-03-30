import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo
} from 'react'
import type { ReactNode } from 'react'

interface ErrorContextValue {
  lastError: string | null
  setError: (message: string) => void
  clearError: () => void
}

const ErrorContext = createContext<ErrorContextValue | null>(null)

export function useError(): ErrorContextValue {
  const ctx = useContext(ErrorContext)
  if (!ctx) {
    throw new Error('useError must be used within an ErrorProvider')
  }
  return ctx
}

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [lastError, setLastError] = useState<string | null>(null)

  const setError = useCallback((message: string) => {
    setLastError(message)
  }, [])

  const clearError = useCallback(() => {
    setLastError(null)
  }, [])

  const value = useMemo<ErrorContextValue>(
    () => ({ lastError, setError, clearError }),
    [lastError, setError, clearError]
  )

  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>
}
