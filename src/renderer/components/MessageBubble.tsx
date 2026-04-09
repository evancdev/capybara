import { memo } from 'react'
import type {
  CapybaraMessage,
  ToolApprovalResponse
} from '@/shared/types/messages'
import {
  AssistantTextDeltaBlock,
  AssistantMessageBlock
} from '@/renderer/components/messages/AssistantMessage'
import { UserMessageBlock } from '@/renderer/components/messages/UserMessage'
import {
  ToolUseRequestBlock,
  ToolResultBlock,
  ToolProgressBlock,
  ToolUseSummaryBlock
} from '@/renderer/components/messages/ToolMessages'
import { TaskUpdateBlock } from '@/renderer/components/messages/TaskMessage'
import {
  SystemMessageBlock,
  UsageMessageBlock,
  MetadataUpdatedBlock,
  SessionStateBlock
} from '@/renderer/components/messages/SystemMessage'
import { ErrorMessageBlock } from '@/renderer/components/messages/ErrorMessage'
import { InterAgentMessageBlock } from '@/renderer/components/messages/InterAgentMessage'
import { ThinkingSection } from '@/renderer/components/messages/ThinkingSection'

// ---------------------------------------------------------------------------
// MessageBubble — thin dispatcher on message.kind
//
// Each message family lives in its own file under ./messages/. This file only
// selects which sub-component to render for a given CapybaraMessage kind.
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: CapybaraMessage
  onRespondToToolApproval?: (response: ToolApprovalResponse) => void
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onRespondToToolApproval
}: MessageBubbleProps) {
  switch (message.kind) {
    case 'assistant_text_delta':
      return <AssistantTextDeltaBlock message={message} />
    case 'assistant_message':
      return <AssistantMessageBlock message={message} />
    case 'tool_use_request':
      return (
        <ToolUseRequestBlock
          message={message}
          onRespondToToolApproval={onRespondToToolApproval}
        />
      )
    case 'tool_result':
      return <ToolResultBlock message={message} />
    case 'system_message':
      return <SystemMessageBlock message={message} />
    case 'error_message':
      return <ErrorMessageBlock message={message} />
    case 'usage_message':
      return <UsageMessageBlock _message={message} />
    case 'inter_agent_message':
      return <InterAgentMessageBlock message={message} />
    case 'user_message':
      return <UserMessageBlock message={message} />
    case 'metadata_updated':
      return <MetadataUpdatedBlock _message={message} />
    case 'thinking_delta':
      return <ThinkingSection text={message.text} />
    case 'tool_progress':
      return <ToolProgressBlock message={message} />
    case 'task_update':
      return <TaskUpdateBlock message={message} />
    case 'session_state':
      return <SessionStateBlock message={message} />
    case 'tool_use_summary':
      return <ToolUseSummaryBlock message={message} />
    default: {
      // Exhaustiveness check — if a new kind is added to the union,
      // TypeScript will error here until we handle it.
      const _exhaustive: never = message
      void _exhaustive
      return null
    }
  }
})
