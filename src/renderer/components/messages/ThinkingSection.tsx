import { useState, useCallback } from 'react'
import styles from '@/renderer/styles/MessagePanel.module.css'

// ---------------------------------------------------------------------------
// Thinking section — reused by ThinkingDelta and ThinkingBlock in content
// ---------------------------------------------------------------------------

export function ThinkingSection({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  return (
    <div className={styles.thinkingSection}>
      <button
        className={styles.thinkingHeader}
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-label={`Thinking section. Click to ${expanded ? 'collapse' : 'expand'}.`}
      >
        <span
          className={`${styles.toolChevron} ${expanded ? styles.toolChevronOpen : ''}`}
          aria-hidden="true"
        >
          &#9654;
        </span>
        <span className={styles.thinkingHeaderLabel}>Thinking...</span>
      </button>
      {expanded ? <div className={styles.thinkingBody}>{text}</div> : null}
    </div>
  )
}
