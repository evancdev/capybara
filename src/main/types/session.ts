import type { IPty } from 'node-pty'
import type { SessionDescriptor } from '@/shared/types/session'

export interface InternalSession extends SessionDescriptor {
  pty: IPty
  defaultName: string
  buffer: string[]
  bufferSize: number
}
