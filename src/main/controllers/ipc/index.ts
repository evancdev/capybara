import type { BrowserWindow } from 'electron'
import type { SessionManager } from '@/main/services/session-manager'
import { ConversationHistoryService } from '@/main/services/conversation-history'
import type { ValidateSender, SendToRenderer } from '@/main/types/ipc'
import { registerSessionHandlers } from '@/main/controllers/ipc/session'
import { registerTerminalHandlers } from '@/main/controllers/ipc/terminal'
import { registerSystemHandlers } from '@/main/controllers/ipc/system'

function createValidateSender(
  getMainWindow: () => BrowserWindow | null
): ValidateSender {
  return function validateSender(event) {
    const win = getMainWindow()
    if (win?.webContents.id !== event.sender.id) {
      throw new Error('[IPC] sender is not the main window')
    }
  }
}

function createSendToRenderer(
  getMainWindow: () => BrowserWindow | null
): SendToRenderer {
  return function sendToRenderer(channel, ...args) {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

export function registerIpcHandlers(
  sessionManager: SessionManager,
  getMainWindow: () => BrowserWindow | null
): void {
  const validateSender = createValidateSender(getMainWindow)
  const sendToRenderer = createSendToRenderer(getMainWindow)

  const conversationHistoryService = new ConversationHistoryService()
  registerSessionHandlers(
    sessionManager,
    conversationHistoryService,
    validateSender,
    sendToRenderer
  )
  registerTerminalHandlers(sessionManager, validateSender)
  registerSystemHandlers(getMainWindow, validateSender)
}
