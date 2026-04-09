import type { SessionService } from '@/main/services/session'
import { IPC } from '@/shared/types/constants'
import { TOOL_APPROVAL_TIMEOUT_MS } from '@/main/types/constants'
import { sendToRenderer } from '@/main/ipc/transport'
import type {
  CapybaraMessage,
  ToolApprovalRequest
} from '@/shared/types/messages'

/**
 * Subscribes to SessionService events and forwards them to the renderer over IPC.
 * Call once at app startup, after the session service is constructed.
 */
export function forwardSessionEvents(sessionService: SessionService): void {
  sessionService.on(
    'message',
    (sessionId: string, message: CapybaraMessage) => {
      sendToRenderer(IPC.SESSION_MESSAGE, sessionId, message)
    }
  )

  sessionService.on('exited', (sessionId: string, exitCode: number) => {
    sendToRenderer(IPC.SESSION_EXITED, sessionId, exitCode)
  })

  sessionService.on('tool-approval', (req: ToolApprovalRequest) => {
    const payload: ToolApprovalRequest = {
      ...req,
      timeoutMs: TOOL_APPROVAL_TIMEOUT_MS
    }
    sendToRenderer(IPC.TOOL_APPROVAL_REQUEST, payload)
  })
}
