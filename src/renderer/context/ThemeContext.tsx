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
import type { ThemeConfig } from '@/renderer/types/theme'
import { DEFAULT_THEME, THEME_PRESETS } from '@/renderer/types/theme'

const STORAGE_KEY = 'capybara-theme'
const DEFAULT_SLUG = THEME_PRESETS[0].slug

interface ThemeContextValue {
  theme: ThemeConfig
  activePresetName: string | null
  setThemePreset: (name: string, theme: ThemeConfig) => void
  resetTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}

interface StoredTheme {
  presetName: string | null
  slug: string
  theme: ThemeConfig
}

function loadTheme(): StoredTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored)
      return {
        presetName: THEME_PRESETS[0].name,
        slug: DEFAULT_SLUG,
        theme: DEFAULT_THEME
      }
    const parsed = JSON.parse(stored) as Partial<StoredTheme>
    return {
      presetName: parsed.presetName ?? null,
      slug: parsed.slug ?? DEFAULT_SLUG,
      theme: {
        ui: { ...DEFAULT_THEME.ui, ...parsed.theme?.ui },
        terminal: { ...DEFAULT_THEME.terminal, ...parsed.theme?.terminal }
      }
    }
  } catch {
    return {
      presetName: THEME_PRESETS[0].name,
      slug: DEFAULT_SLUG,
      theme: DEFAULT_THEME
    }
  }
}

function findSlug(name: string): string {
  const preset = THEME_PRESETS.find((p) => p.name === name)
  return preset?.slug ?? DEFAULT_SLUG
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredTheme>(loadTheme)
  const initialRender = useRef(true)

  // Apply data-theme attribute — CSS handles the rest
  useEffect(() => {
    document.documentElement.dataset.theme = stored.slug
  }, [stored.slug])

  // Persist on change (skip initial render to avoid writing defaults)
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }, [stored])

  const setThemePreset = useCallback((name: string, theme: ThemeConfig) => {
    setStored({ presetName: name, slug: findSlug(name), theme })
  }, [])

  const resetTheme = useCallback(() => {
    setStored({
      presetName: THEME_PRESETS[0].name,
      slug: DEFAULT_SLUG,
      theme: DEFAULT_THEME
    })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: stored.theme,
      activePresetName: stored.presetName,
      setThemePreset,
      resetTheme
    }),
    [stored, setThemePreset, resetTheme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
