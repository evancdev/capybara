import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IPty } from 'node-pty'
import { SessionNotFoundError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// node-pty mock
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

function createDefaultSession(manager: InstanceType<typeof SessionManager>, overrides?: { cwd?: string; name?: string; resumeConversationId?: string }) {
  return manager.create(
    { cwd: overrides?.cwd ?? '/Users/test/project', name: overrides?.name, resumeConversationId: overrides?.resumeConversationId },
    noopOnData,
    noopOnExit
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPtyInstance = createMockPty()
    noopOnData.mockReset()
    noopOnExit.mockReset()
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('returns a valid SessionDescriptor with required fields', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      expect(descriptor).toHaveProperty('id')
      expect(typeof descriptor.id).toBe('string')
      expect(descriptor.id.length).toBeGreaterThan(0)
      expect(descriptor).toHaveProperty('pid')
      expect(typeof descriptor.pid).toBe('number')
      expect(descriptor.status).toBe('running')
      expect(descriptor.exitCode).toBeNull()
      expect(descriptor.command).toBe('claude')
      expect(descriptor.cwd).toBe('/Users/test/project')
      expect(typeof descriptor.createdAt).toBe('number')
    })

    it('sets command to "claude --resume <id>" when resumeConversationId is provided', () => {
      const manager = createManager()
      const conversationId = '550e8400-e29b-41d4-a716-446655440000'
      const descriptor = createDefaultSession(manager, { resumeConversationId: conversationId })

      expect(descriptor.command).toBe(`claude --resume ${conversationId}`)
    })

    it('uses provided name when given', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager, { name: 'My Agent' })

      expect(descriptor.name).toBe('My Agent')
    })

    it('generates a default name like "Agent N" when no name provided', () => {
      const manager = createManager()
      const d1 = createDefaultSession(manager)
      const d2 = createDefaultSession(manager)

      expect(d1.name).toBe('Agent 1')
      expect(d2.name).toBe('Agent 2')
    })

    it('assigns unique IDs to each session', () => {
      const manager = createManager()
      const d1 = createDefaultSession(manager)
      const d2 = createDefaultSession(manager)

      expect(d1.id).not.toBe(d2.id)
    })

    it('throws when per-project cap is reached for the same cwd', () => {
      const manager = createManager()
      const cwd = '/Users/test/capped-project'

      // Create MAX_AGENTS_PER_PROJECT sessions (5)
      for (let i = 0; i < 5; i++) {
        createDefaultSession(manager, { cwd })
      }

      expect(() => createDefaultSession(manager, { cwd })).toThrow(
        /maximum.*5.*active sessions/i
      )
    })

    it('allows sessions in different cwds beyond per-project cap', () => {
      const manager = createManager()

      for (let i = 0; i < 5; i++) {
        createDefaultSession(manager, { cwd: '/Users/test/project-a' })
      }

      // Different cwd should still work
      expect(() =>
        createDefaultSession(manager, { cwd: '/Users/test/project-b' })
      ).not.toThrow()
    })

    it('registers onData callback on the pty', () => {
      const manager = createManager()
      createDefaultSession(manager)

      expect(mockPtyInstance.onData).toHaveBeenCalledOnce()
      expect(mockPtyInstance.onData).toHaveBeenCalledWith(expect.any(Function))
    })

    it('registers onExit callback on the pty', () => {
      const manager = createManager()
      createDefaultSession(manager)

      expect(mockPtyInstance.onExit).toHaveBeenCalledOnce()
      expect(mockPtyInstance.onExit).toHaveBeenCalledWith(expect.any(Function))
    })

    it('forwards pty data to the onData callback with session id', () => {
      const manager = createManager()
      const onData = vi.fn()
      const descriptor = manager.create(
        { cwd: '/Users/test/project' },
        onData,
        noopOnExit
      )

      // Simulate pty emitting data
      const dataHandler = vi.mocked(mockPtyInstance.onData).mock.calls[0][0] as (data: string) => void
      dataHandler('hello world')

      expect(onData).toHaveBeenCalledWith(descriptor.id, 'hello world')
    })

    it('forwards pty exit to the onExit callback with session id and exit code', () => {
      const manager = createManager()
      const onExit = vi.fn()
      const descriptor = manager.create(
        { cwd: '/Users/test/project' },
        noopOnData,
        onExit
      )

      // Simulate pty exit
      const exitHandler = vi.mocked(mockPtyInstance.onExit).mock.calls[0][0] as (e: { exitCode: number; signal?: number }) => void
      exitHandler({ exitCode: 0 })

      expect(onExit).toHaveBeenCalledWith(descriptor.id, 0)
    })

    it('propagates non-zero exit codes through onExit callback', () => {
      const manager = createManager()
      const onExit = vi.fn()
      const descriptor = manager.create(
        { cwd: '/Users/test/project' },
        noopOnData,
        onExit
      )

      const exitHandler = vi.mocked(mockPtyInstance.onExit).mock.calls[0][0] as (e: { exitCode: number; signal?: number }) => void
      exitHandler({ exitCode: 137 })

      expect(onExit).toHaveBeenCalledWith(descriptor.id, 137)
    })

    it('removes session from map after pty exits', () => {
      const manager = createManager()
      createDefaultSession(manager)

      expect(manager.list()).toHaveLength(1)

      const exitHandler = vi.mocked(mockPtyInstance.onExit).mock.calls[0][0] as (e: { exitCode: number }) => void
      exitHandler({ exitCode: 0 })

      expect(manager.list()).toHaveLength(0)
    })

    it('does not count exited sessions toward the per-project cap', () => {
      const manager = createManager()
      const cwd = '/Users/test/capped-project'

      // Create 5 sessions
      for (let i = 0; i < 5; i++) {
        mockPtyInstance = createMockPty()
        createDefaultSession(manager, { cwd })
      }

      // Simulate first session exiting -- get the onExit handler from the first pty
      // We need to track mock instances. Let's instead destroy one and create a new one.
      // Actually, we can list sessions and destroy one.
      const sessions = manager.list()
      manager.destroy(sessions[0].id)

      // Now we should be able to create another
      mockPtyInstance = createMockPty()
      expect(() => createDefaultSession(manager, { cwd })).not.toThrow()
    })

  })

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------
  describe('destroy()', () => {
    it('removes the session from the manager', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      manager.destroy(descriptor.id)

      expect(manager.list()).toHaveLength(0)
    })

    it('calls kill on the pty for running sessions', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      manager.destroy(descriptor.id)

      expect(mockPtyInstance.kill).toHaveBeenCalledOnce()
    })

    it('is a silent no-op for unknown ID', () => {
      const manager = createManager()

      expect(() => manager.destroy('nonexistent-id')).not.toThrow()
    })

    it('is a silent no-op when destroying same session twice', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      manager.destroy(descriptor.id)

      expect(() => manager.destroy(descriptor.id)).not.toThrow()
    })

    it('is a silent no-op if session has already exited (removed from map)', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      // Simulate exit -- onExit removes session from map
      const exitHandler = vi.mocked(mockPtyInstance.onExit).mock.calls[0][0] as (e: { exitCode: number }) => void
      exitHandler({ exitCode: 0 })

      expect(() => manager.destroy(descriptor.id)).not.toThrow()
    })

    it('still removes session from map when pty.kill() throws', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      vi.mocked(mockPtyInstance.kill).mockImplementation(() => {
        throw new Error('kill failed')
      })

      expect(() => manager.destroy(descriptor.id)).not.toThrow()
      expect(manager.list()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // destroyAll()
  // -------------------------------------------------------------------------
  describe('destroyAll()', () => {
    it('removes all sessions', () => {
      const manager = createManager()

      mockPtyInstance = createMockPty()
      createDefaultSession(manager)
      mockPtyInstance = createMockPty()
      createDefaultSession(manager)

      manager.destroyAll()

      expect(manager.list()).toHaveLength(0)
    })

    it('kills all running ptys', () => {
      const manager = createManager()
      const ptys: IPty[] = []

      for (let i = 0; i < 3; i++) {
        mockPtyInstance = createMockPty()
        ptys.push(mockPtyInstance)
        createDefaultSession(manager)
      }

      manager.destroyAll()

      for (const p of ptys) {
        expect(p.kill).toHaveBeenCalledOnce()
      }
    })

    it('is safe to call when no sessions exist', () => {
      const manager = createManager()
      expect(() => manager.destroyAll()).not.toThrow()
    })

    it('resets nextSessionNumber so new sessions start at Agent 1', () => {
      const manager = createManager()
      mockPtyInstance = createMockPty()
      createDefaultSession(manager) // Agent 1
      mockPtyInstance = createMockPty()
      createDefaultSession(manager) // Agent 2

      manager.destroyAll()

      mockPtyInstance = createMockPty()
      const d = createDefaultSession(manager)
      expect(d.name).toBe('Agent 1')
    })
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns empty array when no sessions exist', () => {
      const manager = createManager()
      expect(manager.list()).toEqual([])
    })

    it('returns all created sessions', () => {
      const manager = createManager()

      mockPtyInstance = createMockPty()
      createDefaultSession(manager)
      mockPtyInstance = createMockPty()
      createDefaultSession(manager)

      expect(manager.list()).toHaveLength(2)
    })

    it('returns descriptors with all expected properties', () => {
      const manager = createManager()
      createDefaultSession(manager)

      const [descriptor] = manager.list()

      expect(descriptor).toHaveProperty('id')
      expect(descriptor).toHaveProperty('pid')
      expect(descriptor).toHaveProperty('status')
      expect(descriptor).toHaveProperty('exitCode')
      expect(descriptor).toHaveProperty('command')
      expect(descriptor).toHaveProperty('cwd')
      expect(descriptor).toHaveProperty('name')
      expect(descriptor).toHaveProperty('createdAt')
      // Ensure internal properties are NOT leaked
      expect(descriptor).not.toHaveProperty('pty')
      expect(descriptor).not.toHaveProperty('buffer')
      expect(descriptor).not.toHaveProperty('bufferSize')
      expect(descriptor).not.toHaveProperty('defaultName')
    })

    it('does not include destroyed sessions', () => {
      const manager = createManager()
      mockPtyInstance = createMockPty()
      const d1 = createDefaultSession(manager)
      mockPtyInstance = createMockPty()
      createDefaultSession(manager)

      manager.destroy(d1.id)

      expect(manager.list()).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // rename()
  // -------------------------------------------------------------------------
  describe('rename()', () => {
    it('updates the session name', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const updated = manager.rename(descriptor.id, 'New Name')

      expect(updated.name).toBe('New Name')
    })

    it('falls back to default name when given empty string', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const updated = manager.rename(descriptor.id, '')

      expect(updated.name).toBe('Agent 1')
    })

    it('falls back to default name when given whitespace-only string', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const updated = manager.rename(descriptor.id, '   ')

      expect(updated.name).toBe('Agent 1')
    })

    it('trims whitespace from name', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const updated = manager.rename(descriptor.id, '  Trimmed  ')

      expect(updated.name).toBe('Trimmed')
    })

    it('throws SessionNotFoundError for unknown session', () => {
      const manager = createManager()

      expect(() => manager.rename('nonexistent', 'test')).toThrow(SessionNotFoundError)
    })

    it('returns a valid SessionDescriptor', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const updated = manager.rename(descriptor.id, 'Renamed')

      expect(updated).toHaveProperty('id', descriptor.id)
      expect(updated).toHaveProperty('status', 'running')
      expect(updated).toHaveProperty('cwd')
    })
  })

  // -------------------------------------------------------------------------
  // resize()
  // -------------------------------------------------------------------------
  describe('resize()', () => {
    it('calls pty.resize with the given dimensions', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      manager.resize(descriptor.id, 120, 40)

      expect(mockPtyInstance.resize).toHaveBeenCalledWith(120, 40)
    })

    it('throws SessionNotFoundError for unknown session', () => {
      const manager = createManager()

      expect(() => manager.resize('nonexistent', 80, 24)).toThrow(SessionNotFoundError)
    })

    it('throws SessionNotFoundError if session has exited (removed from map)', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const exitHandler = vi.mocked(mockPtyInstance.onExit).mock.calls[0][0] as (e: { exitCode: number }) => void
      exitHandler({ exitCode: 0 })

      expect(() => manager.resize(descriptor.id, 120, 40)).toThrow(SessionNotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // write()
  // -------------------------------------------------------------------------
  describe('write()', () => {
    it('calls pty.write with the given data', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      manager.write(descriptor.id, 'hello')

      expect(mockPtyInstance.write).toHaveBeenCalledWith('hello')
    })

    it('throws SessionNotFoundError for unknown session', () => {
      const manager = createManager()

      expect(() => manager.write('nonexistent', 'data')).toThrow(SessionNotFoundError)
    })

    it('throws SessionNotFoundError if session has exited (removed from map)', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const exitHandler = vi.mocked(mockPtyInstance.onExit).mock.calls[0][0] as (e: { exitCode: number }) => void
      exitHandler({ exitCode: 0 })

      expect(() => manager.write(descriptor.id, 'should not send')).toThrow(SessionNotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // snapshotAndClearBuffer()
  // -------------------------------------------------------------------------
  describe('snapshotAndClearBuffer()', () => {
    it('returns empty string when buffer is empty', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const snapshot = manager.snapshotAndClearBuffer(descriptor.id)

      expect(snapshot).toBe('')
    })

    it('returns joined buffer contents', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      // Simulate data arriving via the onData handler
      const dataHandler = vi.mocked(mockPtyInstance.onData).mock.calls[0][0] as (data: string) => void
      dataHandler('chunk1')
      dataHandler('chunk2')

      const snapshot = manager.snapshotAndClearBuffer(descriptor.id)

      expect(snapshot).toBe('chunk1chunk2')
    })

    it('clears buffer after snapshot', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const dataHandler = vi.mocked(mockPtyInstance.onData).mock.calls[0][0] as (data: string) => void
      dataHandler('data')

      manager.snapshotAndClearBuffer(descriptor.id)
      const second = manager.snapshotAndClearBuffer(descriptor.id)

      expect(second).toBe('')
    })

    it('throws SessionNotFoundError for unknown session', () => {
      const manager = createManager()

      expect(() => manager.snapshotAndClearBuffer('nonexistent')).toThrow(SessionNotFoundError)
    })
  })

  // -------------------------------------------------------------------------
  // Global session cap (MAX_GLOBAL_SESSIONS = 20)
  // -------------------------------------------------------------------------
  describe('global session cap', () => {
    it('throws when total sessions across all cwds exceeds 20', () => {
      const manager = createManager()

      // Create 20 sessions: 5 different cwds x 4 sessions each = 20
      const cwds = [
        '/Users/test/project-a',
        '/Users/test/project-b',
        '/Users/test/project-c',
        '/Users/test/project-d',
        '/Users/test/project-e'
      ]
      for (const cwd of cwds) {
        for (let i = 0; i < 4; i++) {
          mockPtyInstance = createMockPty()
          createDefaultSession(manager, { cwd })
        }
      }

      expect(manager.list()).toHaveLength(20)

      // The 21st session should fail regardless of cwd
      mockPtyInstance = createMockPty()
      expect(() =>
        createDefaultSession(manager, { cwd: '/Users/test/project-f' })
      ).toThrow(/maximum.*20.*sessions/i)
    })

    it('allows creation after destroying a session when at global cap', () => {
      const manager = createManager()

      // Fill to global cap
      for (let i = 0; i < 20; i++) {
        mockPtyInstance = createMockPty()
        createDefaultSession(manager, { cwd: `/Users/test/proj-${i % 5}` })
      }

      // Destroy one
      const sessions = manager.list()
      manager.destroy(sessions[0].id)

      // Now creation should succeed
      mockPtyInstance = createMockPty()
      expect(() =>
        createDefaultSession(manager, { cwd: '/Users/test/proj-0' })
      ).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Destroying flag behavior during destroyAll()
  // -------------------------------------------------------------------------
  describe('destroying flag suppresses callbacks during destroyAll', () => {
    it('suppresses onData callbacks fired during destroyAll', () => {
      const manager = createManager()
      const onData = vi.fn()
      const onExit = vi.fn()

      // Create a session and capture the pty's onData callback
      const ptyForTest = createMockPty()
      mockPtyInstance = ptyForTest
      manager.create({ cwd: '/Users/test/project' }, onData, onExit)

      const dataHandler = vi.mocked(ptyForTest.onData).mock
        .calls[0][0] as (data: string) => void

      // Wire up the mock pty.kill to simulate onData firing during kill
      // (simulates a pty flushing data as it is being killed)
      vi.mocked(ptyForTest.kill).mockImplementation(() => {
        dataHandler('dying gasp of data')
      })

      // Reset the onData mock to only count calls during destroyAll
      onData.mockClear()

      manager.destroyAll()

      // The onData callback should NOT have been forwarded
      expect(onData).not.toHaveBeenCalled()
    })

    it('suppresses onExit callbacks fired during destroyAll', () => {
      const manager = createManager()
      const onData = vi.fn()
      const onExit = vi.fn()

      const ptyForTest = createMockPty()
      mockPtyInstance = ptyForTest
      manager.create({ cwd: '/Users/test/project' }, onData, onExit)

      const exitHandler = vi.mocked(ptyForTest.onExit).mock
        .calls[0][0] as (e: { exitCode: number }) => void

      // Wire up kill to simulate onExit firing during kill
      vi.mocked(ptyForTest.kill).mockImplementation(() => {
        exitHandler({ exitCode: 137 })
      })

      onExit.mockClear()

      manager.destroyAll()

      // The onExit callback should NOT have been forwarded
      expect(onExit).not.toHaveBeenCalled()
    })

    it('resets destroying flag after destroyAll completes', () => {
      const manager = createManager()
      createDefaultSession(manager)

      manager.destroyAll()

      // After destroyAll, creating new sessions should work (flag is reset)
      mockPtyInstance = createMockPty()
      expect(() => createDefaultSession(manager)).not.toThrow()

      // And onData should work on the new session
      const onData = vi.fn()
      mockPtyInstance = createMockPty()
      manager.create({ cwd: '/Users/test/project' }, onData, noopOnExit)

      const dataHandler = vi.mocked(mockPtyInstance.onData).mock
        .calls[0][0] as (data: string) => void
      dataHandler('post-destroy data')

      expect(onData).toHaveBeenCalledWith(expect.any(String), 'post-destroy data')
    })
  })

  // -------------------------------------------------------------------------
  // Multi-session buffer isolation
  // -------------------------------------------------------------------------
  describe('multi-session buffer isolation', () => {
    it('buffers are independent between sessions', () => {
      const manager = createManager()
      const onData1 = vi.fn()
      const onData2 = vi.fn()

      const pty1 = createMockPty()
      mockPtyInstance = pty1
      const d1 = manager.create({ cwd: '/Users/test/project' }, onData1, noopOnExit)

      const pty2 = createMockPty()
      mockPtyInstance = pty2
      const d2 = manager.create({ cwd: '/Users/test/project' }, onData2, noopOnExit)

      // Send data to session 1 only
      const dataHandler1 = vi.mocked(pty1.onData).mock.calls[0][0] as (data: string) => void
      dataHandler1('session1-data')

      // Session 1 buffer should have data, session 2 should be empty
      const snap1 = manager.snapshotAndClearBuffer(d1.id)
      const snap2 = manager.snapshotAndClearBuffer(d2.id)

      expect(snap1).toBe('session1-data')
      expect(snap2).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // Buffer trimming
  // -------------------------------------------------------------------------
  describe('buffer trimming', () => {
    it('trims old chunks when buffer exceeds MAX_BUFFER_SIZE', () => {
      const manager = createManager()
      const descriptor = createDefaultSession(manager)

      const dataHandler = vi.mocked(mockPtyInstance.onData).mock.calls[0][0] as (data: string) => void

      // MAX_BUFFER_SIZE is 5 * 1024 * 1024 = 5242880
      // Push many chunks that exceed the limit
      const chunkSize = 1024 * 1024 // 1MB each
      const chunk = 'x'.repeat(chunkSize)
      for (let i = 0; i < 7; i++) {
        dataHandler(chunk)
      }

      const snapshot = manager.snapshotAndClearBuffer(descriptor.id)
      // Buffer should have been trimmed. Total raw data = 7MB, limit = 5MB
      // So some early chunks should have been dropped.
      expect(snapshot.length).toBeLessThanOrEqual(5242880 + chunkSize) // at most limit + one chunk overshoot
      expect(snapshot.length).toBeGreaterThan(0)
    })
  })

})
