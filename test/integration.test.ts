import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IPty } from 'node-pty'
import { SessionNotFoundError } from '@/main/lib/errors'
import { MAX_AGENTS_PER_PROJECT } from '@/shared/types/constants'
import { MAX_GLOBAL_SESSIONS } from '@/main/types/constants'

// ---------------------------------------------------------------------------
// node-pty mock (same pattern as session-manager.test.ts)
// ---------------------------------------------------------------------------
function createMockPty(): IPty {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: Math.floor(Math.random() * 90000) + 10000,
    cols: 80,
    rows: 24,
    process: 'claude',
    handleFlowControl: false,
    on: vi.fn(),
    emit: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
    listeners: vi.fn().mockReturnValue([]),
    rawListeners: vi.fn().mockReturnValue([]),
    listenerCount: vi.fn().mockReturnValue(0),
    prependListener: vi.fn(),
    prependOnceListener: vi.fn(),
    eventNames: vi.fn().mockReturnValue([]),
    once: vi.fn(),
    setMaxListeners: vi.fn(),
    getMaxListeners: vi.fn().mockReturnValue(10),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn()
  } as unknown as IPty
}

let mockPtyInstance: IPty

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPtyInstance)
}))

// Must import after mock is set up
const { SessionManager } = await import('@/main/services/session-manager')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const noopOnData = vi.fn()
const noopOnExit = vi.fn()

function createManager(): InstanceType<typeof SessionManager> {
  return new SessionManager()
}

function createSession(
  manager: InstanceType<typeof SessionManager>,
  overrides?: { cwd?: string; name?: string }
) {
  mockPtyInstance = createMockPty()
  return manager.create(
    { cwd: overrides?.cwd ?? '/Users/test/project', name: overrides?.name },
    noopOnData,
    noopOnExit
  )
}

// ---------------------------------------------------------------------------
// Integration tests — chaining multiple SessionManager operations
// ---------------------------------------------------------------------------
describe('SessionManager integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPtyInstance = createMockPty()
    noopOnData.mockReset()
    noopOnExit.mockReset()
  })

  // -------------------------------------------------------------------------
  // 1. Session lifecycle round-trip
  // -------------------------------------------------------------------------
  describe('session lifecycle round-trip', () => {
    it('create -> list -> rename -> verify rename in list -> destroy -> verify removed', () => {
      const manager = createManager()

      // Create
      const descriptor = createSession(manager)
      expect(descriptor.status).toBe('running')
      expect(descriptor.name).toBe('Agent 1')

      // List — session appears
      const listAfterCreate = manager.list()
      expect(listAfterCreate).toHaveLength(1)
      expect(listAfterCreate[0].id).toBe(descriptor.id)

      // Rename
      const renamed = manager.rename(descriptor.id, 'My Integration Session')
      expect(renamed.name).toBe('My Integration Session')

      // Verify rename persists in list
      const listAfterRename = manager.list()
      expect(listAfterRename[0].name).toBe('My Integration Session')

      // Destroy
      manager.destroy(descriptor.id)

      // Verify removed from list
      const listAfterDestroy = manager.list()
      expect(listAfterDestroy).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // 2. Multi-session management
  // -------------------------------------------------------------------------
  describe('multi-session management', () => {
    it('create 3 sessions -> verify all in list -> destroy one -> verify others remain', () => {
      const manager = createManager()

      // Create 3 sessions
      const d1 = createSession(manager, { name: 'First' })
      const d2 = createSession(manager, { name: 'Second' })
      const d3 = createSession(manager, { name: 'Third' })

      // Verify all 3 appear in list
      const listAll = manager.list()
      expect(listAll).toHaveLength(3)
      const ids = listAll.map((s) => s.id)
      expect(ids).toContain(d1.id)
      expect(ids).toContain(d2.id)
      expect(ids).toContain(d3.id)

      // Destroy the middle one
      manager.destroy(d2.id)

      // Verify the other two remain
      const listAfter = manager.list()
      expect(listAfter).toHaveLength(2)
      const remainingIds = listAfter.map((s) => s.id)
      expect(remainingIds).toContain(d1.id)
      expect(remainingIds).toContain(d3.id)
      expect(remainingIds).not.toContain(d2.id)
    })
  })

  // -------------------------------------------------------------------------
  // 3. Buffer lifecycle
  // -------------------------------------------------------------------------
  describe('buffer lifecycle', () => {
    it('create -> simulate onData -> getBuffer -> verify content -> snapshotAndClear -> verify cleared', () => {
      const manager = createManager()
      const pty = createMockPty()
      mockPtyInstance = pty
      const descriptor = manager.create(
        { cwd: '/Users/test/project' },
        noopOnData,
        noopOnExit
      )

      // Simulate pty emitting data
      const dataHandler = vi.mocked(pty.onData).mock.calls[0][0] as (
        data: string
      ) => void
      dataHandler('line-one\r\n')
      dataHandler('line-two\r\n')

      // getBuffer returns accumulated content
      const buffer = manager.getBuffer(descriptor.id)
      expect(buffer).toBe('line-one\r\nline-two\r\n')

      // snapshotAndClearBuffer returns same content then clears
      const snapshot = manager.snapshotAndClearBuffer(descriptor.id)
      expect(snapshot).toBe('line-one\r\nline-two\r\n')

      // Buffer is now empty
      const afterClear = manager.getBuffer(descriptor.id)
      expect(afterClear).toBe('')

      // Second snapshot confirms empty
      const secondSnapshot = manager.snapshotAndClearBuffer(descriptor.id)
      expect(secondSnapshot).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // 4. Per-project session cap
  // -------------------------------------------------------------------------
  describe('per-project session cap', () => {
    it('creates MAX_AGENTS_PER_PROJECT sessions then rejects next for same cwd but allows different cwd', () => {
      const manager = createManager()
      const cwd = '/Users/test/capped-project'

      // Fill to per-project cap
      for (let i = 0; i < MAX_AGENTS_PER_PROJECT; i++) {
        createSession(manager, { cwd })
      }

      expect(manager.list()).toHaveLength(MAX_AGENTS_PER_PROJECT)

      // Next session for same cwd should throw
      mockPtyInstance = createMockPty()
      expect(() =>
        manager.create(
          { cwd },
          noopOnData,
          noopOnExit
        )
      ).toThrow(/maximum.*active sessions/i)

      // Different cwd should succeed
      const differentCwd = '/Users/test/other-project'
      const d = createSession(manager, { cwd: differentCwd })
      expect(d.cwd).toBe(differentCwd)
      expect(manager.list()).toHaveLength(MAX_AGENTS_PER_PROJECT + 1)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Global session cap
  // -------------------------------------------------------------------------
  describe('global session cap', () => {
    it('fills MAX_GLOBAL_SESSIONS across multiple cwds then rejects any new session', () => {
      const manager = createManager()

      // Create MAX_GLOBAL_SESSIONS sessions spread across cwds to stay
      // under the per-project cap (5 per cwd, 4 cwds = 20)
      const cwdCount = MAX_GLOBAL_SESSIONS / MAX_AGENTS_PER_PROJECT
      for (let c = 0; c < cwdCount; c++) {
        for (let i = 0; i < MAX_AGENTS_PER_PROJECT; i++) {
          createSession(manager, { cwd: `/Users/test/proj-${c}` })
        }
      }

      expect(manager.list()).toHaveLength(MAX_GLOBAL_SESSIONS)

      // Any new session should fail regardless of cwd
      mockPtyInstance = createMockPty()
      expect(() =>
        manager.create(
          { cwd: '/Users/test/brand-new-project' },
          noopOnData,
          noopOnExit
        )
      ).toThrow(/maximum.*20.*sessions/i)
    })
  })

  // -------------------------------------------------------------------------
  // 6. destroyAll lifecycle
  // -------------------------------------------------------------------------
  describe('destroyAll lifecycle', () => {
    it('create multiple -> destroyAll -> verify empty -> create new works with counter reset', () => {
      const manager = createManager()

      // Create 3 sessions — counter advances to 4
      createSession(manager)
      createSession(manager)
      createSession(manager)
      expect(manager.list()).toHaveLength(3)

      // destroyAll
      manager.destroyAll()
      expect(manager.list()).toHaveLength(0)

      // Create new session — counter should have reset, so name is "Agent 1"
      const fresh = createSession(manager)
      expect(fresh.name).toBe('Agent 1')
      expect(fresh.status).toBe('running')
      expect(manager.list()).toHaveLength(1)
    })
  })
})
