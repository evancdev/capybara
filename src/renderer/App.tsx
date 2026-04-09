import { useCallback, useState } from 'react'
import { ErrorProvider } from '@/renderer/context/ErrorContext'
import { SessionProvider } from '@/renderer/context/SessionContext'
import { MessageProvider } from '@/renderer/context/MessageContext'
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
  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [])

  useKeyboardShortcuts(toggleSettings)

  return (
    <div className="app">
      <TitleBar onOpenSettings={toggleSettings} settingsOpen={settingsOpen} />
      <div className="app-body">
        <ErrorBoundary>
          {settingsOpen ? (
            <SettingsPanel onClose={closeSettings} />
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
          <SessionProvider>
            <MessageProvider>
              <AppShell />
            </MessageProvider>
          </SessionProvider>
        </ErrorProvider>
      </KeyBindingsProvider>
    </ThemeProvider>
  )
}
