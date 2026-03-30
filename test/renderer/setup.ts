import { vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { SessionAPI } from '../../src/preload/types/session'

// ---------------------------------------------------------------------------
// Mock window.sessionAPI — the typed preload bridge surface.
// Each test can override individual methods via vi.mocked().
// ---------------------------------------------------------------------------

function createMockSessionAPI(): {
  [K in keyof SessionAPI]: SessionAPI[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...args: A) => R>>
    : SessionAPI[K]
} {
  return {
    createSession: vi.fn().mockResolvedValue({
      id: 'mock-id',
      pid: 1234,
      status: 'running' as const,
      exitCode: null,
      command: 'claude',
      cwd: '/mock',
      name: 'Agent 1',
      createdAt: Date.now()
    }),
    destroySession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue({
      id: 'mock-id',
      pid: 1234,
      status: 'running' as const,
      exitCode: null,
      command: 'claude',
      cwd: '/mock',
      name: 'Renamed',
      createdAt: Date.now()
    }),
    listSessions: vi.fn().mockResolvedValue([]),
    resizeSession: vi.fn().mockResolvedValue(undefined),
    sendInput: vi.fn(),
    onTerminalOutput: vi.fn(),
    offTerminalOutput: vi.fn(),
    onSessionExited: vi.fn(),
    offSessionExited: vi.fn(),
    selectDirectory: vi.fn().mockResolvedValue(null),
    replaySession: vi.fn().mockResolvedValue(''),
    getSessionHistory: vi.fn().mockResolvedValue(''),
    getPromptInfo: vi.fn().mockResolvedValue({ username: 'test', hostname: 'test-host' }),
    listConversations: vi.fn().mockResolvedValue([])
  }
}

// Attach to the global window object before each test file runs.
// Individual tests can access vi.mocked(window.sessionAPI.someMethod) to
// customize return values or assert calls.
Object.defineProperty(window, 'sessionAPI', {
  value: createMockSessionAPI(),
  writable: true,
  configurable: true
})

// Reset all sessionAPI mocks between tests so state does not leak.
beforeEach(() => {
  const fresh = createMockSessionAPI()
  Object.assign(window.sessionAPI, fresh)
})

// Mock localStorage for ConversationHistory tests
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null)
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true
})

// Suppress console.error noise from ErrorBoundary tests.
// Tests that need to assert on console.error should spy on it themselves.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
