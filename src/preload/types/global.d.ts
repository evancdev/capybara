import type { SessionAPI } from './session'

declare global {
  interface Window {
    sessionAPI: SessionAPI
  }
}
