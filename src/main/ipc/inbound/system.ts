import { dialog } from 'electron'
import { IPC } from '@/shared/types/constants'
import { handle } from '@/main/ipc/transport'
import { getWindow } from '@/main/bootstrap/window'

/** Registers OS-level IPC channels (e.g. the native directory picker). Call once at app startup. */
export function registerSystemHandlers(): void {
  handle(IPC.DIALOG_OPEN_DIRECTORY, async () => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
