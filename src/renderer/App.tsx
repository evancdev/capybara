import { useState, useCallback } from 'react'
import { ErrorProvider } from '@/renderer/context/ErrorContext'
import { TerminalDispatchProvider } from '@/renderer/context/TerminalDispatchContext'
import { SessionProvider } from '@/renderer/context/SessionContext'
import { ThemeProvider } from '@/renderer/context/ThemeContext'
import { KeyBindingsProvider } from '@/renderer/context/KeyBindingsContext'
import { useKeyboardShortcuts } from '@/renderer/hooks/useKeyboardShortcuts'
import { TitleBar } from '@/renderer/components/TitleBar'
import { SessionLayout } from '@/renderer/components/SessionLayout'
import { SettingsPanel } from '@/renderer/components/SettingsPanel'
import { ErrorBoundary } from '@/renderer/components/ErrorBoundary'

function AppShell() {
  const [settingsOpen, setSettingsOpen] = useState(false)

  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => !prev)
  }, [])

  useKeyboardShortcuts(toggleSettings)

  return (
    <div className="app">
      <TitleBar onOpenSettings={toggleSettings} settingsOpen={settingsOpen} />
      <div className="app-body">
        <ErrorBoundary>
          {settingsOpen ? (
            <SettingsPanel onClose={toggleSettings} />
          ) : (
            <SessionLayout />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <KeyBindingsProvider>
        <ErrorProvider>
          <TerminalDispatchProvider>
            <SessionProvider>
              <AppShell />
            </SessionProvider>
          </TerminalDispatchProvider>
        </ErrorProvider>
      </KeyBindingsProvider>
    </ThemeProvider>
  )
}
