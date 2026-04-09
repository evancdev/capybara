import type { ContentBlock } from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'
import { ThinkingSection } from '@/renderer/components/messages/ThinkingSection'
import { toolSummaryText } from '@/renderer/components/messages/toolFormatters'

// ---------------------------------------------------------------------------
// Content block renderer — handles all ContentBlock types inside
// an AssistantMessage
// ---------------------------------------------------------------------------

export function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'thinking':
      return <ThinkingSection text={block.thinking} />

    case 'redacted_thinking':
      return (
        <div className={styles.dimmedText} role="status">
          [thinking redacted]
        </div>
      )

    case 'server_tool_use': {
      const stu = block
      const summary = toolSummaryText(stu.toolName, stu.input)
      return (
        <div className={styles.toolRow}>
          <div className={styles.toolHeader} role="status">
            <span className={styles.toolChevron} aria-hidden="true">
              &#9654;
            </span>
            <span className={styles.toolName}>{stu.toolName}</span>
            {summary ? (
              <span className={styles.toolSummary}>{summary}</span>
            ) : null}
          </div>
        </div>
      )
    }

    case 'web_search_tool_result': {
      const ws = block
      return (
        <div className={styles.webSearchResult}>
          <div className={styles.webSearchQuery} role="status">
            Search: {ws.searchQuery}
          </div>
          {ws.results.map((result, ri) => (
            <div key={ri} className={styles.webSearchItem}>
              <a
                href={result.url}
                className={styles.webSearchLink}
                target="_blank"
                rel="noopener noreferrer"
              >
                {result.title}
              </a>
              <div className={styles.webSearchSnippet}>{result.snippet}</div>
            </div>
          ))}
        </div>
      )
    }

    case 'mcp_tool_use': {
      const mtu = block
      const summary = toolSummaryText(mtu.toolName, mtu.input)
      return (
        <div className={styles.toolRow}>
          <div className={styles.toolHeader} role="status">
            <span className={styles.toolChevron} aria-hidden="true">
              &#9654;
            </span>
            <span className={styles.toolName}>
              {mtu.serverName}/{mtu.toolName}
            </span>
            {summary ? (
              <span className={styles.toolSummary}>{summary}</span>
            ) : null}
          </div>
        </div>
      )
    }

    case 'mcp_tool_result': {
      const mtr = block
      return (
        <div className={styles.toolResultRow}>
          <div
            className={`${styles.toolResultBody} ${mtr.isError ? styles.toolResultBodyError : ''}`}
          >
            {mtr.output}
          </div>
        </div>
      )
    }

    case 'unknown': {
      const ub = block
      return (
        <div className={styles.dimmedText} role="status">
          [{ub.rawType}]
        </div>
      )
    }

    // text, tool_use, tool_result are handled by the parent or their own message kinds
    case 'text':
    case 'tool_use':
    case 'tool_result':
      return null

    default: {
      // Future-proof fallback for any content block type not yet handled
      const unknownType = (block as { type: string }).type
      return (
        <div className={styles.dimmedText} role="status">
          [{unknownType}]
        </div>
      )
    }
  }
}
