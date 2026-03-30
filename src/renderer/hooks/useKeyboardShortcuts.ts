import { useEffect } from 'react'
import { useSession } from '@/renderer/context/SessionContext'
import { useKeyBindings } from '@/renderer/context/KeyBindingsContext'
import { matchesBinding } from '@/renderer/types/keybindings'

export function useKeyboardShortcuts(onToggleSettings: () => void): void {
  const {
    projects,
    activeProjectPath,
    activeSessionId,
    createAgent,
    destroyAgent,
    openProject,
    closeProject,
    setActiveSession
  } = useSession()

  const { bindings } = useKeyBindings()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      if (matchesBinding(e, bindings.newAgent)) {
        e.preventDefault()
        const project =
          activeProjectPath !== null
            ? projects.get(activeProjectPath)
            : undefined
        if (project) {
          void createAgent(project.path)
        }
        return
      }

      if (matchesBinding(e, bindings.closeAgent)) {
        e.preventDefault()
        if (activeSessionId) {
          void destroyAgent(activeSessionId)
        }
        return
      }

      if (matchesBinding(e, bindings.newProject)) {
        e.preventDefault()
        void openProject()
        return
      }

      if (matchesBinding(e, bindings.closeProject)) {
        e.preventDefault()
        if (activeProjectPath) {
          void closeProject(activeProjectPath)
        }
        return
      }

      if (matchesBinding(e, bindings.toggleSettings)) {
        e.preventDefault()
        onToggleSettings()
        return
      }

      // Cmd+1-9 → Switch to agent by index
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const project =
          activeProjectPath !== null
            ? projects.get(activeProjectPath)
            : undefined
        if (!project) return
        const idx = parseInt(e.key, 10) - 1
        if (idx < project.sessions.length) {
          setActiveSession(project.sessions[idx].id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    projects,
    activeProjectPath,
    activeSessionId,
    createAgent,
    destroyAgent,
    openProject,
    closeProject,
    setActiveSession,
    onToggleSettings,
    bindings
  ])
}
