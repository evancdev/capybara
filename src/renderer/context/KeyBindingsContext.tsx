import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef
} from 'react'
import type { ReactNode } from 'react'
import type {
  KeyBindingsConfig,
  KeyBinding
} from '@/renderer/types/keybindings'
import { DEFAULT_KEYBINDINGS } from '@/renderer/types/keybindings'

const STORAGE_KEY = 'capybara-keybindings'

interface KeyBindingsContextValue {
  bindings: KeyBindingsConfig
  updateBinding: (action: keyof KeyBindingsConfig, binding: KeyBinding) => void
  resetBindings: () => void
}

const KeyBindingsContext = createContext<KeyBindingsContextValue | null>(null)

export function useKeyBindings(): KeyBindingsContextValue {
  const ctx = useContext(KeyBindingsContext)
  if (!ctx) {
    throw new Error('useKeyBindings must be used within a KeyBindingsProvider')
  }
  return ctx
}

function loadBindings(): KeyBindingsConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_KEYBINDINGS
    const parsed = JSON.parse(stored) as Partial<KeyBindingsConfig>
    return { ...DEFAULT_KEYBINDINGS, ...parsed }
  } catch {
    return DEFAULT_KEYBINDINGS
  }
}

export function KeyBindingsProvider({ children }: { children: ReactNode }) {
  const [bindings, setBindings] = useState<KeyBindingsConfig>(loadBindings)

  const initialRender = useRef(true)
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  }, [bindings])

  const updateBinding = useCallback(
    (action: keyof KeyBindingsConfig, binding: KeyBinding) => {
      setBindings((prev) => ({ ...prev, [action]: binding }))
    },
    []
  )

  const resetBindings = useCallback(() => {
    setBindings(DEFAULT_KEYBINDINGS)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const value = useMemo<KeyBindingsContextValue>(
    () => ({ bindings, updateBinding, resetBindings }),
    [bindings, updateBinding, resetBindings]
  )

  return (
    <KeyBindingsContext.Provider value={value}>
      {children}
    </KeyBindingsContext.Provider>
  )
}
