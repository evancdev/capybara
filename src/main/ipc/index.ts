import type { SessionService } from '@/main/services/session'
import { registerInboundHandlers } from '@/main/ipc/inbound'
import { registerOutboundForwarders } from '@/main/ipc/outbound'

/**
 * Wires all IPC plumbing: inbound handlers (renderer → main) and outbound
 * event forwarders (main → renderer). Call once at app startup.
 */
export function registerIpc(sessionService: SessionService): void {
  registerInboundHandlers(sessionService)
  registerOutboundForwarders(sessionService)
}
