import type { IPC } from '@/shared/types/constants'

export type ValidateSender = (
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
) => void

export interface SendToRenderer {
  (channel: typeof IPC.TERMINAL_OUTPUT, sessionId: string, data: string): void
  (
    channel: typeof IPC.SESSION_EXITED,
    sessionId: string,
    exitCode: number
  ): void
}

export interface ValidateCwdDeps {
  homedir: () => string
  stat: (p: string) => Promise<{ isDirectory: () => boolean }>
  resolve: (...paths: string[]) => string
  sep: string
}
