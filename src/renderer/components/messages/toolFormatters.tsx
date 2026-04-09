import type { ReactNode } from 'react'
import styles from '@/renderer/styles/MessagePanel.module.css'

// ---------------------------------------------------------------------------
// Shared tool-input formatting helpers
// ---------------------------------------------------------------------------

/** Read `input[key]` as a string, or return undefined if missing/wrong type. */
export function getString(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const v = input[key]
  return typeof v === 'string' ? v : undefined
}

/** Read the first defined string among common file-path keys. */
export function getFilePath(
  input: Record<string, unknown>
): string | undefined {
  return (
    getString(input, 'file_path') ??
    getString(input, 'file') ??
    getString(input, 'path')
  )
}

/** Extract just the filename from an absolute or relative path. */
function shortenPath(fullPath: string): string {
  const parts = fullPath.split('/')
  return parts[parts.length - 1] || fullPath
}

/** Truncate with an ellipsis if over `max` chars. */
export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s
}

/**
 * Derive a short human-readable one-liner for a tool invocation header.
 * Shown in the collapsed tool row next to the tool name.
 */
export function toolSummaryText(
  toolName: string,
  input: Record<string, unknown>
): string {
  const name = toolName.toLowerCase()
  const str = (key: string): string | undefined => getString(input, key)

  // -- Bash / shell commands --
  if (name === 'bash' || name === 'terminal' || name === 'execute') {
    const cmd = str('command') ?? str('cmd') ?? ''
    return cmd ? truncate(cmd, 80) : ''
  }

  // -- Edit tool: show file path --
  if (name === 'edit') {
    const fp = getFilePath(input)
    return fp ? shortenPath(fp) : ''
  }

  // -- Write tool: show file path --
  if (name === 'write') {
    const fp = getFilePath(input)
    return fp ? shortenPath(fp) : ''
  }

  // -- Read tool: show file path with optional line range --
  if (name === 'read') {
    const fp = getFilePath(input) ?? ''
    if (!fp) return ''
    const short = shortenPath(fp)
    const offset = input.offset
    const limit = input.limit
    if (typeof offset === 'number' && typeof limit === 'number') {
      return `${short}:${offset}-${offset + limit}`
    }
    if (typeof offset === 'number') {
      return `${short}:${offset}`
    }
    return short
  }

  // -- Grep tool: show pattern in path --
  if (name === 'grep') {
    const pattern = str('pattern') ?? ''
    const path = str('path')
    if (pattern && path) return `${truncate(pattern, 40)} in ${shortenPath(path)}`
    return pattern ? truncate(pattern, 60) : ''
  }

  // -- Glob tool: show pattern --
  if (name === 'glob') {
    return str('pattern') ?? ''
  }

  // -- Web search / fetch --
  if (name === 'websearch' || name === 'web_search') {
    return str('query') ?? str('search_query') ?? ''
  }
  if (name === 'webfetch' || name === 'web_fetch') {
    return str('url') ?? ''
  }

  // -- Agent / Task / TodoWrite --
  if (
    name === 'task' ||
    name === 'agent' ||
    name === 'dispatch_agent' ||
    name === 'todowrite'
  ) {
    const prompt = str('prompt') ?? str('description') ?? str('task') ?? ''
    return prompt ? truncate(prompt, 60) : ''
  }

  // -- Generic fallback: file_path > path > file > command > pattern --
  const filePath = getFilePath(input)
  if (filePath) return shortenPath(filePath)
  const commandVal = str('command')
  if (commandVal) return truncate(commandVal, 80)
  const patternVal = str('pattern')
  if (patternVal) return patternVal

  return ''
}

// ---------------------------------------------------------------------------
// Human-readable tool input formatter — replaces raw JSON in expanded view
// ---------------------------------------------------------------------------

/**
 * Render a human-readable view of a tool's input for the expanded body.
 * Known tools get special formatting; unknown tools get key-value pairs.
 */
export function formatToolInput(
  toolName: string,
  input: Record<string, unknown>
): ReactNode {
  const name = toolName.toLowerCase()
  const str = (key: string): string | undefined => getString(input, key)

  // -- Bash: show command prominently --
  if (name === 'bash' || name === 'terminal' || name === 'execute') {
    const cmd = str('command') ?? str('cmd')
    if (cmd) {
      const rest = Object.entries(input).filter(
        ([k]) => k !== 'command' && k !== 'cmd'
      )
      return (
        <div className={styles.toolInputFormatted}>
          <div className={styles.toolInputCommand}>$ {cmd}</div>
          {rest.length > 0 && renderKeyValuePairs(rest)}
        </div>
      )
    }
  }

  // -- Edit: show file path + mini diff of old/new --
  if (name === 'edit') {
    const filePath = getFilePath(input)
    const oldStr = str('old_string')
    const newStr = str('new_string')
    const rest = Object.entries(input).filter(
      ([k]) =>
        !['file_path', 'file', 'path', 'old_string', 'new_string'].includes(k)
    )
    return (
      <div className={styles.toolInputFormatted}>
        {filePath ? (
          <div className={styles.toolInputFilePath}>{shortenPath(filePath)}</div>
        ) : null}
        {(oldStr !== undefined || newStr !== undefined) && (
          <div className={styles.toolInputDiff}>
            {oldStr !== undefined && (
              <div className={styles.toolInputDiffRemove}>- {oldStr}</div>
            )}
            {newStr !== undefined && (
              <div className={styles.toolInputDiffAdd}>+ {newStr}</div>
            )}
          </div>
        )}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  // -- Write: show file path + content preview --
  if (name === 'write') {
    const filePath = getFilePath(input)
    const content = str('content')
    const rest = Object.entries(input).filter(
      ([k]) => !['file_path', 'file', 'path', 'content'].includes(k)
    )
    const contentLines = content ? content.split('\n') : null
    return (
      <div className={styles.toolInputFormatted}>
        {filePath ? (
          <div className={styles.toolInputFilePath}>{shortenPath(filePath)}</div>
        ) : null}
        {contentLines ? (
          <div className={styles.toolInputPreview}>
            {contentLines.slice(0, 5).join('\n')}
            {contentLines.length > 5 && (
              <div className={styles.toolInputTruncated}>
                ... ({contentLines.length} lines total)
              </div>
            )}
          </div>
        ) : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  // -- Read / Grep / Glob: show file/pattern prominently --
  if (name === 'read') {
    const filePath = getFilePath(input)
    const rest = Object.entries(input).filter(
      ([k]) => !['file_path', 'file', 'path'].includes(k)
    )
    return (
      <div className={styles.toolInputFormatted}>
        {filePath ? (
          <div className={styles.toolInputFilePath}>{shortenPath(filePath)}</div>
        ) : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  if (name === 'grep') {
    const pattern = str('pattern')
    const path = str('path')
    const rest = Object.entries(input).filter(
      ([k]) => !['pattern', 'path'].includes(k)
    )
    return (
      <div className={styles.toolInputFormatted}>
        {pattern ? (
          <div className={styles.toolInputFilePath}>/{pattern}/</div>
        ) : null}
        {path ? (
          <div className={styles.toolInputSecondary}>in {path}</div>
        ) : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  if (name === 'glob') {
    const pattern = str('pattern')
    const path = str('path')
    const rest = Object.entries(input).filter(
      ([k]) => !['pattern', 'path'].includes(k)
    )
    return (
      <div className={styles.toolInputFormatted}>
        {pattern ? (
          <div className={styles.toolInputFilePath}>{pattern}</div>
        ) : null}
        {path ? (
          <div className={styles.toolInputSecondary}>in {path}</div>
        ) : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  // -- WebSearch / WebFetch --
  if (name === 'websearch' || name === 'web_search') {
    const query = str('query') ?? str('search_query')
    const rest = Object.entries(input).filter(
      ([k]) => !['query', 'search_query'].includes(k)
    )
    return (
      <div className={styles.toolInputFormatted}>
        {query ? (
          <div className={styles.toolInputFilePath}>Search: {query}</div>
        ) : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  if (name === 'webfetch' || name === 'web_fetch') {
    const url = str('url')
    const rest = Object.entries(input).filter(([k]) => k !== 'url')
    return (
      <div className={styles.toolInputFormatted}>
        {url ? <div className={styles.toolInputFilePath}>{url}</div> : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  // -- Agent / Task --
  if (name === 'task' || name === 'agent' || name === 'dispatch_agent') {
    const prompt = str('prompt') ?? str('description') ?? str('task')
    const rest = Object.entries(input).filter(
      ([k]) => !['prompt', 'description', 'task'].includes(k)
    )
    return (
      <div className={styles.toolInputFormatted}>
        {prompt ? (
          <div className={styles.toolInputPreview}>{prompt}</div>
        ) : null}
        {rest.length > 0 && renderKeyValuePairs(rest)}
      </div>
    )
  }

  // -- Fallback: formatted key-value pairs (never raw JSON) --
  return (
    <div className={styles.toolInputFormatted}>
      {renderKeyValuePairs(Object.entries(input))}
    </div>
  )
}

/**
 * Render a list of key-value pairs in a readable format.
 * Values that are objects/arrays are stringified with indentation.
 */
function renderKeyValuePairs(entries: [string, unknown][]): ReactNode {
  return (
    <div className={styles.toolInputKvPairs}>
      {entries.map(([key, value]) => {
        const displayValue =
          typeof value === 'string'
            ? value
            : value === null || value === undefined
              ? String(value)
              : JSON.stringify(value, null, 2)
        return (
          <div key={key} className={styles.toolInputKvRow}>
            <span className={styles.toolInputKvKey}>{key}:</span>{' '}
            <span className={styles.toolInputKvValue}>{displayValue}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Generate a plain-English description of what a tool wants to do.
 * Used in the approval context before approve/deny buttons.
 */
export function toolApprovalSummary(
  toolName: string,
  input: Record<string, unknown>,
  title?: string
): string {
  if (title) return title

  const name = toolName.toLowerCase()

  if (name === 'bash' || name === 'terminal' || name === 'execute') {
    const cmd = getString(input, 'command') ?? getString(input, 'cmd')
    if (cmd) return `Claude wants to run: \`${truncate(cmd, 60)}\``
    return `Claude wants to execute a shell command`
  }

  if (name === 'edit') {
    const fp = getFilePath(input)
    if (fp) return `Claude wants to edit \`${shortenPath(fp)}\``
  }

  if (name === 'write') {
    const fp = getFilePath(input)
    if (fp) return `Claude wants to write to \`${shortenPath(fp)}\``
  }

  if (name === 'read') {
    const fp = getFilePath(input)
    if (fp) return `Claude wants to read \`${shortenPath(fp)}\``
  }

  return `Claude wants to use ${toolName}`
}

/**
 * Detect whether output text looks like a unified diff.
 * Checks for `---`/`+++` header pairs or `@@` hunk markers.
 */
export function looksLikeDiff(text: string): boolean {
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('@@') && line.includes('@@', 2)) return true
    if (line.startsWith('--- ') || line.startsWith('+++ ')) return true
  }
  return false
}

/**
 * Classify a single diff line for styling.
 */
export function diffLineClass(line: string): string {
  if (line.startsWith('@@')) return styles.diffHunk
  if (line.startsWith('+++') || line.startsWith('---')) return styles.diffMeta
  if (line.startsWith('+')) return styles.diffAdd
  if (line.startsWith('-')) return styles.diffRemove
  return styles.diffContext
}
