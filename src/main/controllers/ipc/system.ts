import { type BrowserWindow, dialog } from 'electron'
import os from 'node:os'
import { IPC } from '@/shared/types/constants'
import type { PromptInfo } from '@/shared/types/session'
import type { ValidateSender } from '@/main/types/ipc'
import { handle } from '@/main/controllers/ipc/safe-handler'

export function registerSystemHandlers(
  getMainWindow: () => BrowserWindow | null,
  validateSender: ValidateSender
): void {
  const promptInfo: PromptInfo = {
    username: os.userInfo().username,
    hostname: os.hostname().replace(/\.local$/, '')
  }

  handle(IPC.GET_PROMPT_INFO, (event) => {
    validateSender(event)
    return promptInfo
  })

  handle(IPC.DIALOG_OPEN_DIRECTORY, async (event) => {
    validateSender(event)
    const win = getMainWindow()
    if (!win || win.isDestroyed()) {
      return null
    }
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })
}
