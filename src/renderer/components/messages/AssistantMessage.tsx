import { Streamdown } from 'streamdown'
import type {
  AssistantMessage,
  AssistantTextDelta
} from '@/shared/types/messages'
import styles from '@/renderer/styles/MessagePanel.module.css'
import {
  codePlugin,
  STREAMDOWN_SECURITY_PROPS
} from '@/renderer/components/messages/streamdown'
import { ContentBlockRenderer } from '@/renderer/components/messages/ContentBlockRenderer'

// ---------------------------------------------------------------------------
// Streaming text delta
// ---------------------------------------------------------------------------

export function AssistantTextDeltaBlock({
  message
}: {
  message: AssistantTextDelta
}) {
  return (
    <div className={styles.assistantText}>
      <div className={styles.textContent}>
        <Streamdown
          plugins={{ code: codePlugin }}
          mode="streaming"
          {...STREAMDOWN_SECURITY_PROPS}
        >
          {message.text}
        </Streamdown>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assistant message — renders content blocks
// ---------------------------------------------------------------------------

export function AssistantMessageBlock({
  message
}: {
  message: AssistantMessage
}) {
  const blocks = message.content

  // Collect text blocks into groups, render non-text blocks individually
  const elements: React.ReactNode[] = []
  let textAccumulator: string[] = []

  const flushText = (key: string) => {
    if (textAccumulator.length > 0) {
      const joined = textAccumulator.join('\n')
      elements.push(
        <div key={key} className={styles.assistantText}>
          <div className={styles.textContent}>
            <Streamdown
              plugins={{ code: codePlugin }}
              mode="static"
              {...STREAMDOWN_SECURITY_PROPS}
            >
              {joined}
            </Streamdown>
          </div>
        </div>
      )
      textAccumulator = []
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'text') {
      textAccumulator.push(block.text)
    } else if (block.type === 'tool_use' || block.type === 'tool_result') {
      // These are handled by their own message kinds (ToolUseRequest, ToolResult)
      flushText(`text-pre-${i}`)
    } else {
      flushText(`text-pre-${i}`)
      elements.push(<ContentBlockRenderer key={`block-${i}`} block={block} />)
    }
  }

  // Flush any remaining text
  flushText('text-final')

  if (elements.length === 0) return null

  return <>{elements}</>
}
