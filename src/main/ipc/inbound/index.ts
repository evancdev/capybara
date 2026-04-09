import type { SessionService } from '@/main/services/session'
import { registerSessionHandlers } from '@/main/ipc/inbound/session'
import { registerSystemHandlers } from '@/main/ipc/inbound/system'

/** Registers every inbound IPC handler (renderer → main). Call once at startup. */
export function registerInboundHandlers(sessionService: SessionService): void {
  registerSessionHandlers(sessionService)
  registerSystemHandlers()
}
