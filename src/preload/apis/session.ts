import { ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '@/shared/types/constants'
import type { PermissionMode, Session } from '@/shared/types/session'
import type {
  CreateSessionInput,
  ListConversationsInput,
  RenameConversationInput
} from '@/shared/schemas/session'
import type {
  CapybaraMessage,
  ToolApprovalRequest,
  ToolApprovalResponse
} from '@/shared/types/messages'

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void

/**
 * Build a fan-out subscription for a broadcast IPC channel.
 *
 * Prior to this helper, every `onX` entry in this file installed its own
 * single-slot listener and clobbered any previous subscriber — so if two
 * React contexts both called `onMessage`, the first one silently stopped
 * receiving events. The fan-out pattern installs a single underlying
 * `ipcRenderer.on` listener per channel and multiplexes to a Set of
 * JS subscribers, so every caller gets every event.
 *
 * @param channel   IPC channel name
 * @param validate  Runtime guard that converts raw IPC args into a typed
 *                  payload, or returns null to drop the message.
 */
function createFanout<T>(
  channel: string,
  validate: (args: unknown[]) => T | null
): (callback: (payload: T) => void) => () => void {
  const subscribers = new Set<(payload: T) => void>()
  let ipcListener: IpcListener | null = null

  function ensureInstalled(): void {
    if (ipcListener) return
    ipcListener = (_event, ...args) => {
      const payload = validate(args)
      if (payload === null) return
      for (const cb of subscribers) {
        cb(payload)
      }
    }
    ipcRenderer.on(channel, ipcListener)
  }

  return (callback) => {
    ensureInstalled()
    subscribers.add(callback)
    return () => {
      subscribers.delete(callback)
    }
  }
}

// ---- Fan-out subscriptions --------------------------------------------------

const onSessionExitedSubscribe = createFanout<{
  sessionId: string
  exitCode: number
}>(IPC.SESSION_EXITED, (args) => {
  if (typeof args[0] !== 'string' || typeof args[1] !== 'number') return null
  return { sessionId: args[0], exitCode: args[1] }
})

const onMessageSubscribe = createFanout<CapybaraMessage>(
  IPC.SESSION_MESSAGE,
  (args) => {
    // sendToRenderer dispatches (channel, sessionId, message) so the
    // listener receives the sessionId at args[0] and the message at args[1].
    if (typeof args[0] !== 'string') return null
    if (typeof args[1] !== 'object' || args[1] === null) return null
    const msg = args[1] as CapybaraMessage
    if (typeof msg.kind !== 'string' || typeof msg.sessionId !== 'string') {
      return null
    }
    return msg
  }
)

const onToolApprovalRequestSubscribe = createFanout<ToolApprovalRequest>(
  IPC.TOOL_APPROVAL_REQUEST,
  (args) => {
    if (typeof args[0] !== 'object' || args[0] === null) return null
    const req = args[0] as ToolApprovalRequest
    if (
      typeof req.sessionId !== 'string' ||
      typeof req.toolUseId !== 'string' ||
      typeof req.toolName !== 'string'
    ) {
      return null
    }
    return req
  }
)

const onUserInfoSubscribe = createFanout<{
  username: string
  hostname: string
  homedir: string
}>(IPC.USER_INFO, (args) => {
  if (typeof args[0] !== 'object' || args[0] === null) return null
  const info = args[0] as {
    username: string
    hostname: string
    homedir: string
  }
  if (
    typeof info.username !== 'string' ||
    typeof info.hostname !== 'string' ||
    typeof info.homedir !== 'string'
  ) {
    return null
  }
  return info
})

export const sessionAPI = {
  createSession: (input: CreateSessionInput): Promise<Session> =>
    ipcRenderer.invoke(IPC.SESSION_CREATE, input),

  destroySession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_DESTROY, sessionId),

  stopResponse: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_STOP_RESPONSE, sessionId),

  listSessions: (): Promise<Session[]> => ipcRenderer.invoke(IPC.SESSION_LIST),

  onSessionExited: (
    callback: (sessionId: string, exitCode: number) => void
  ): (() => void) =>
    onSessionExitedSubscribe(({ sessionId, exitCode }) => {
      callback(sessionId, exitCode)
    }),

  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_DIRECTORY),

  listConversations: (projectPath: string): Promise<Session[]> =>
    ipcRenderer.invoke(IPC.SESSION_LIST_CONVERSATIONS, {
      projectPath
    } satisfies ListConversationsInput),

  renameConversation: (input: RenameConversationInput): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_RENAME_CONVERSATION, input),

  // -- Messaging --------------------------------------------------------------

  sendMessage: (sessionId: string, message: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_SEND_MESSAGE, { sessionId, message }),

  getMessages: (sessionId: string): Promise<CapybaraMessage[]> =>
    ipcRenderer.invoke(IPC.SESSION_GET_MESSAGES, { sessionId }),

  respondToToolApproval: (response: ToolApprovalResponse): Promise<void> =>
    ipcRenderer.invoke(IPC.TOOL_APPROVAL_RESPONSE, response),

  setPermissionMode: (
    sessionId: string,
    mode: PermissionMode
  ): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_SET_PERMISSION_MODE, { sessionId, mode }),

  runCommand: (
    sessionId: string,
    command: string,
    args: string[]
  ): Promise<{ newSessionId?: string }> =>
    ipcRenderer.invoke(IPC.SESSION_RUN_COMMAND, { sessionId, command, args }),

  onMessage: (callback: (message: CapybaraMessage) => void): (() => void) =>
    onMessageSubscribe(callback),

  onToolApprovalRequest: (
    callback: (request: ToolApprovalRequest) => void
  ): (() => void) => onToolApprovalRequestSubscribe(callback),

  onUserInfo: (
    callback: (info: { username: string; hostname: string }) => void
  ): (() => void) => onUserInfoSubscribe(callback)
}
