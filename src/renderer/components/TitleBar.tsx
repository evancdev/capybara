import { useSession } from '@/renderer/context/SessionContext'
import { cx } from '@/renderer/lib/cx'
import { handleTabArrowNav } from '@/renderer/lib/tab-nav'
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
              className={cx(
                styles.projectTab,
                isActive && styles.active,
                isClosing && styles.closing
              )}
              onClick={() => {
                setActiveProject(project.path)
              }}
              onKeyDown={(e) => {
                if (handleTabArrowNav(e, 'horizontal')) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setActiveProject(project.path)
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
        className={cx(styles.settingsBtn, settingsOpen && styles.active)}
        onClick={onOpenSettings}
        aria-label="Toggle settings"
        title="Settings"
      >
        &#9881;
      </button>
    </div>
  )
}
