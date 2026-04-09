import { Notification, app } from 'electron'
import type { BrowserWindow } from 'electron'
import { getWindow } from '@/main/bootstrap/window'
import type { SessionService } from '@/main/services/session'
import type { SessionState } from '@/shared/types/messages'
import { logger } from '@/main/lib/logger'

/**
 * Fires OS notifications and dock bounce / taskbar flash when agents need
 * attention and the main window is not focused.
 *
 * Subscribes to {@link SessionService}'s `message` event in the constructor
 * and holds event subscriptions for the lifetime of the process.
 */
export class NotificationService {
  private lastIdleNotification = new Map<string, number>()

  constructor(sessionService: SessionService) {
    sessionService.on('message', (sessionId, message) => {
      if (message.kind === 'session_state') {
        this.handleStateChange(sessionId, message.state)
      }
    })
  }

  private handleStateChange(sessionId: string, state: SessionState): void {
    const win = getWindow()
    if (win?.isFocused()) return // user is looking — no notification needed

    if (state === 'requires_action') {
      logger.info('Sending tool-approval notification', { sessionId })
      this.showNotification('Tool approval needed', sessionId)
      this.bounceOrFlash(win)
    } else if (state === 'idle') {
      // Debounce: don't re-notify within 5s for the same session
      const last = this.lastIdleNotification.get(sessionId) ?? 0
      if (Date.now() - last < 5000) return
      this.lastIdleNotification.set(sessionId, Date.now())
      logger.info('Sending agent-finished notification', { sessionId })
      this.showNotification('Agent finished', sessionId)
      this.bounceOrFlash(win)
    }
  }

  private showNotification(title: string, sessionId: string): void {
    const n = new Notification({
      title,
      body: `Session ${sessionId.slice(0, 8)}`
    })
    n.on('click', () => {
      getWindow()?.focus()
    })
    n.show()
  }

  private bounceOrFlash(win: BrowserWindow | null): void {
    if (process.platform === 'darwin') {
      app.dock?.bounce('informational')
    } else {
      win?.flashFrame(true)
    }
  }
}
