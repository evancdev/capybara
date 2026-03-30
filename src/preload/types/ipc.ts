import type { IpcRendererEvent } from 'electron'

export type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void
