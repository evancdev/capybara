import { useSession } from '@/renderer/context/SessionContext'
import { CloseButton } from '@/renderer/ui'
import styles from '@/renderer/styles/TitleBar.module.css'

interface TitleBarProps {
  onOpenSettings: () => void
  settingsOpen: boolean
}

export function TitleBar({ onOpenSettings, settingsOpen }: TitleBarProps) {
  const {
    projects,
    activeProjectPath,
    closingProjectPath,
    openProject,
    closeProject,
    setActiveProject
  } = useSession()

  const projectList = Array.from(projects.values())

  return (
    <div className={styles.titleBar}>
      <div className={styles.tabs} role="tablist" aria-label="Open projects">
        {projectList.map((project) => {
          const isActive = project.path === activeProjectPath && !settingsOpen
          const isClosing = project.path === closingProjectPath
          return (
            <div
              key={project.path}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={`${styles.projectTab} ${isActive ? styles.active : ''} ${isClosing ? styles.closing : ''}`}
              onClick={() => {
                setActiveProject(project.path)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActiveProject(project.path)
                } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  const tabs =
                    e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
                      '[role="tab"]'
                    )
                  if (!tabs || tabs.length === 0) return
                  const currentIdx = Array.from(tabs).indexOf(
                    e.currentTarget as HTMLElement
                  )
                  const nextIdx =
                    e.key === 'ArrowRight'
                      ? (currentIdx + 1) % tabs.length
                      : (currentIdx - 1 + tabs.length) % tabs.length
                  tabs[nextIdx].focus()
                }
              }}
            >
              <span>{project.name}</span>
              <CloseButton
                label="Close project"
                onClick={(e) => {
                  e.stopPropagation()
                  void closeProject(project.path)
                }}
              />
            </div>
          )
        })}
      </div>
      <button
        className={styles.newProjectBtn}
        onClick={() => {
          void openProject()
        }}
        aria-label="Open new project"
        title="Open project"
      >
        +
      </button>
      <button
        className={`${styles.settingsBtn} ${settingsOpen ? styles.active : ''}`}
        onClick={onOpenSettings}
        aria-label="Toggle settings"
        title="Settings"
      >
        &#9881;
      </button>
    </div>
  )
}
