import { ipcRenderer } from 'electron'
import { IPC } from '@/shared/types/constants'
import type {
  SessionDescriptor,
  PromptInfo,
  Conversation
} from '@/shared/types/session'
import type { CreateSessionInput, ResizeInput } from '@/shared/schemas/session'
import type { IpcListener } from '../types/ipc'

// Track listeners so we remove only ours, not other consumers on the same channel.
let terminalOutputListener: IpcListener | null = null
let sessionExitedListener: IpcListener | null = null

export const sessionAPI = {
  createSession: (input: CreateSessionInput): Promise<SessionDescriptor> =>
    ipcRenderer.invoke(IPC.SESSION_CREATE, input),

  destroySession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_DESTROY, sessionId),

  renameSession: (
    sessionId: string,
    name: string
  ): Promise<SessionDescriptor> =>
    ipcRenderer.invoke(IPC.SESSION_RENAME, sessionId, name),

  listSessions: (): Promise<SessionDescriptor[]> =>
    ipcRenderer.invoke(IPC.SESSION_LIST),

  resizeSession: (input: ResizeInput): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_RESIZE, input),

  sendInput: (sessionId: string, data: string): void => {
    ipcRenderer.send(IPC.TERMINAL_INPUT, sessionId, data)
  },

  onTerminalOutput: (
    callback: (sessionId: string, data: string) => void
  ): void => {
    if (terminalOutputListener) {
      ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT, terminalOutputListener)
    }
    terminalOutputListener = (_event, ...args) => {
      if (typeof args[0] !== 'string' || typeof args[1] !== 'string') return
      callback(args[0], args[1])
    }
    ipcRenderer.on(IPC.TERMINAL_OUTPUT, terminalOutputListener)
  },

  offTerminalOutput: (): void => {
    if (terminalOutputListener) {
      ipcRenderer.removeListener(IPC.TERMINAL_OUTPUT, terminalOutputListener)
      terminalOutputListener = null
    }
  },

  onSessionExited: (
    callback: (sessionId: string, exitCode: number) => void
  ): void => {
    if (sessionExitedListener) {
      ipcRenderer.removeListener(IPC.SESSION_EXITED, sessionExitedListener)
    }
    sessionExitedListener = (_event, ...args) => {
      if (typeof args[0] !== 'string' || typeof args[1] !== 'number') return
      callback(args[0], args[1])
    }
    ipcRenderer.on(IPC.SESSION_EXITED, sessionExitedListener)
  },

  offSessionExited: (): void => {
    if (sessionExitedListener) {
      ipcRenderer.removeListener(IPC.SESSION_EXITED, sessionExitedListener)
      sessionExitedListener = null
    }
  },

  replaySession: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke(IPC.SESSION_REPLAY, sessionId),

  getSessionHistory: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke(IPC.SESSION_GET_HISTORY, sessionId),

  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_DIRECTORY),

  getPromptInfo: (): Promise<PromptInfo> =>
    ipcRenderer.invoke(IPC.GET_PROMPT_INFO),

  listConversations: (projectPath: string): Promise<Conversation[]> =>
    ipcRenderer.invoke(IPC.SESSION_LIST_CONVERSATIONS, projectPath)
}
