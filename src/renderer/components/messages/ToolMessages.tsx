import { useState, useCallback, useMemo } from 'react'
import type {
  ToolUseRequest,
  ToolResult,
  ToolProgress,
  ToolUseSummary,
  ToolApprovalResponse
} from '@/shared/types/messages'
import { useSpinner } from '@/renderer/hooks/useSpinner'
import styles from '@/renderer/styles/MessagePanel.module.css'
import {
  toolSummaryText,
  toolApprovalSummary,
  formatToolInput,
  looksLikeDiff,
  diffLineClass
} from '@/renderer/components/messages/toolFormatters'

const TOOL_OUTPUT_COLLAPSED_LINES = 10

// ---------------------------------------------------------------------------
// Tool use request — with enhanced approval context
// ---------------------------------------------------------------------------

interface ToolUseRequestBlockProps {
  message: ToolUseRequest
  onRespondToToolApproval?: (response: ToolApprovalResponse) => void
}

export function ToolUseRequestBlock({
  message,
  onRespondToToolApproval
}: ToolUseRequestBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const [responded, setResponded] = useState(false)

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  const handleApprove = useCallback(() => {
    if (!onRespondToToolApproval || responded) return
    setResponded(true)
    onRespondToToolApproval({
      sessionId: message.sessionId,
      toolUseId: message.toolUseId,
      decision: 'approve',
      message: null
    })
  }, [onRespondToToolApproval, responded, message.sessionId, message.toolUseId])

  const handleDeny = useCallback(() => {
    if (!onRespondToToolApproval || responded) return
    setResponded(true)
    onRespondToToolApproval({
      sessionId: message.sessionId,
      toolUseId: message.toolUseId,
      decision: 'deny',
      message: null
    })
  }, [onRespondToToolApproval, responded, message.sessionId, message.toolUseId])

  const summary = toolSummaryText(message.toolName, message.input)
  const buttonsDisabled = !onRespondToToolApproval || responded
  const approvalText = message.requiresApproval
    ? toolApprovalSummary(message.toolName, message.input, message.title)
    : ''

  return (
    <div className={styles.toolRow}>
      <button
        className={styles.toolHeader}
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-label={`Tool: ${message.toolName}. Click to ${expanded ? 'collapse' : 'expand'} details.`}
      >
        <span
          className={`${styles.toolChevron} ${expanded ? styles.toolChevronOpen : ''}`}
          aria-hidden="true"
        >
          &#9654;
        </span>
        <span className={styles.toolName}>{message.toolName}</span>
        {summary ? <span className={styles.toolSummary}>{summary}</span> : null}
        {message.requiresApproval ? (
          <span className={styles.toolApprovalBadge}>approval required</span>
        ) : null}
      </button>
      {expanded ? (
        <div className={styles.toolBody}>
          {formatToolInput(message.toolName, message.input)}
        </div>
      ) : null}
      {message.requiresApproval ? (
        <div className={styles.toolApprovalContext}>
          <div className={styles.toolApprovalTitle}>
            <span className={styles.toolApprovalWarning} aria-hidden="true">
              &#x26A0;
            </span>{' '}
            {approvalText}
          </div>
          {message.description ? (
            <div className={styles.toolApprovalDescription}>
              {message.description}
            </div>
          ) : null}
          {message.reason ? (
            <div className={styles.toolApprovalReason}>
              Reason: {message.reason}
            </div>
          ) : null}
          <div className={styles.toolActions}>
            <button
              className={styles.approveBtn}
              onClick={handleApprove}
              disabled={buttonsDisabled}
              aria-label={`Approve ${message.toolName}`}
            >
              {responded ? 'Approved' : 'Approve'}
            </button>
            <button
              className={styles.denyBtn}
              onClick={handleDeny}
              disabled={buttonsDisabled}
              aria-label={`Deny ${message.toolName}`}
            >
              {responded ? 'Denied' : 'Deny'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool result
// ---------------------------------------------------------------------------

export function ToolResultBlock({ message }: { message: ToolResult }) {
  const [outputExpanded, setOutputExpanded] = useState(false)

  const lines = useMemo(() => message.output.split('\n'), [message.output])
  const totalLineCount = lines.length
  const isTruncated = totalLineCount > TOOL_OUTPUT_COLLAPSED_LINES
  const isDiff = useMemo(() => looksLikeDiff(message.output), [message.output])

  const handleExpandOutput = useCallback(() => {
    setOutputExpanded((prev) => !prev)
  }, [])

  const visibleLines =
    isTruncated && !outputExpanded
      ? lines.slice(0, TOOL_OUTPUT_COLLAPSED_LINES)
      : lines

  const renderLines = (linesToRender: string[]) => {
    if (!isDiff) {
      return linesToRender.join('\n')
    }
    return linesToRender.map((line, i) => (
      <div key={i} className={`${styles.diffLine} ${diffLineClass(line)}`}>
        {line || '\u00A0'}
      </div>
    ))
  }

  return (
    <div className={styles.toolResultRow}>
      <div
        className={`${styles.toolResultBody} ${message.isError ? styles.toolResultBodyError : ''} ${isTruncated && !outputExpanded ? styles.toolResultTruncated : ''}`}
      >
        {renderLines(visibleLines)}
      </div>
      {isTruncated ? (
        <button
          className={styles.toolExpandBtn}
          onClick={handleExpandOutput}
          aria-label={
            outputExpanded
              ? 'Show less output'
              : `Show all ${totalLineCount} lines`
          }
        >
          {outputExpanded ? 'Show less' : `Show more (${totalLineCount} lines)`}
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool progress
// ---------------------------------------------------------------------------

export function ToolProgressBlock({ message }: { message: ToolProgress }) {
  const char = useSpinner()
  return (
    <div
      className={styles.toolProgressRow}
      role="status"
      aria-label={`${message.toolName} running for ${message.elapsedSeconds}s`}
    >
      <span className={styles.toolProgressSpinner} aria-hidden="true">
        {char}
      </span>
      <span className={styles.toolName}>{message.toolName}</span>
      <span className={styles.toolProgressElapsed}>
        ({message.elapsedSeconds}s)
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool use summary
// ---------------------------------------------------------------------------

export function ToolUseSummaryBlock({ message }: { message: ToolUseSummary }) {
  return (
    <div className={styles.toolUseSummaryRow} role="status">
      <span className={styles.toolUseSummaryLabel}>Summary:</span>
      <span className={styles.toolUseSummaryText}>{message.summary}</span>
    </div>
  )
}
