import { memo, useMemo } from 'react'
import { filterSlashCommands } from '@/renderer/lib/slash-filter'
import styles from '@/renderer/styles/SlashCommandMenu.module.css'

export interface SlashCommandMenuProps {
  /** Whether the menu is currently visible. */
  open: boolean
  /**
   * The text following the leading `/` (no slash). Used for case-insensitive
   * prefix filtering against command names. Empty string shows everything.
   */
  filter: string
  /** Index of the highlighted row within the filtered list. */
  selectedIndex: number
  /** Called when a row is committed (mouse click or via parent's Tab handler). */
  onSelect: (name: string) => void
  /** Called when the menu should close (e.g. user pressed Escape on a row). */
  onDismiss: () => void
}

/**
 * Autocomplete dropdown rendered above the MessagePanel textarea. The parent
 * owns the open state, filter, and selection — this component is a pure
 * presentational view plus mouse-click forwarding.
 */
export const SlashCommandMenu = memo(function SlashCommandMenu({
  open,
  filter,
  selectedIndex,
  onSelect,
  onDismiss
}: SlashCommandMenuProps) {
  const matches = useMemo(() => filterSlashCommands(filter), [filter])

  if (!open) return null

  const hasMatches = matches.length > 0

  return (
    <div
      className={styles.menu}
      role="listbox"
      aria-label="Slash command suggestions"
    >
      {hasMatches ? (
        matches.map((cmd, idx) => {
          const highlighted = idx === selectedIndex
          return (
            <button
              key={cmd.name}
              type="button"
              role="option"
              aria-selected={highlighted}
              className={
                highlighted
                  ? `${styles.row} ${styles.rowHighlighted}`
                  : styles.row
              }
              // Use mousedown so the click commits before the textarea
              // loses focus on blur — keeps focus where the user expects.
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(cmd.name)
              }}
            >
              <span className={styles.name}>/{cmd.name}</span>
              <span className={styles.description}>{cmd.description}</span>
              {cmd.usage !== undefined && cmd.usage !== `/${cmd.name}` ? (
                <span className={styles.usage}>{cmd.usage}</span>
              ) : null}
            </button>
          )
        })
      ) : (
        <div className={styles.emptyRow} role="option" aria-selected="false">
          <span className={styles.emptyText}>no matching commands</span>
          <button
            type="button"
            className={styles.dismissBtn}
            onMouseDown={(e) => {
              e.preventDefault()
              onDismiss()
            }}
            aria-label="Dismiss suggestions"
          >
            esc
          </button>
        </div>
      )}
    </div>
  )
})
