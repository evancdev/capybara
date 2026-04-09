import type { SessionService } from '@/main/services/session'
import { forwardSessionEvents } from '@/main/ipc/outbound/session'

/** Subscribes every outbound event forwarder (main → renderer). Call once at startup. */
export function registerOutboundForwarders(
  sessionService: SessionService
): void {
  forwardSessionEvents(sessionService)
}
