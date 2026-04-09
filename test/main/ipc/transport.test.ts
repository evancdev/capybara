import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks for the boundaries that transport.ts touches
// ---------------------------------------------------------------------------

const handleMap = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handleMap.set(channel, handler)
      }
    ),
    on: vi.fn()
  }
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

let mockGetWindow: () => Electron.BrowserWindow | null = () => null
vi.mock('@/main/bootstrap/window', () => ({
  getWindow: () => mockGetWindow()
}))

const { handle, sendToRenderer } = await import('@/main/ipc/transport')
const { BaseError, UnauthorizedSenderError } = await import(
  '@/main/lib/errors'
)
const { ZodError, z } = await import('zod')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEvent(senderId = 1) {
  return {
    sender: { id: senderId }
  } as unknown as Electron.IpcMainInvokeEvent
}

function createMockWindow(opts?: {
  id?: number
  destroyed?: boolean
}): Electron.BrowserWindow {
  const sendCalls: unknown[][] = []
  const win = {
    isDestroyed: vi.fn().mockReturnValue(opts?.destroyed ?? false),
    webContents: {
      id: opts?.id ?? 1,
      send: vi.fn((...args: unknown[]) => {
        sendCalls.push(args)
      })
    }
  } as unknown as Electron.BrowserWindow
  ;(win as unknown as { __sendCalls: unknown[][] }).__sendCalls = sendCalls
  return win
}

class TestErrorWarn extends BaseError {
  publicMessage = 'public warn message'
}

class TestErrorError extends BaseError {
  publicMessage = 'public error message'
  logLevel: 'warn' | 'error' = 'error'
}

// ---------------------------------------------------------------------------
// handle()
// ---------------------------------------------------------------------------
describe('transport.handle()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handleMap.clear()
    mockGetWindow = () => createMockWindow({ id: 1 })
  })

  describe('happy path', () => {
    it('registers an ipcMain handler for the given channel', async () => {
      handle('test:channel', () => 'ok')
      expect(handleMap.has('test:channel')).toBe(true)
    })

    it('forwards args (without the event) to the user handler', async () => {
      const userHandler = vi.fn().mockReturnValue('ok')
      handle('test:args', userHandler)

      const fn = handleMap.get('test:args')!
      await fn(createMockEvent(), 'arg1', 'arg2', 42)

      expect(userHandler).toHaveBeenCalledWith('arg1', 'arg2', 42)
    })

    it('returns the synchronous handler return value', async () => {
      handle('test:sync', () => 'sync-result')
      const fn = handleMap.get('test:sync')!
      await expect(fn(createMockEvent())).resolves.toBe('sync-result')
    })

    it('awaits and returns an asynchronous handler return value', async () => {
      handle('test:async', async () => 'async-result')
      const fn = handleMap.get('test:async')!
      await expect(fn(createMockEvent())).resolves.toBe('async-result')
    })

    it('does not log anything on the happy path', async () => {
      handle('test:noisy', () => 'fine')
      const fn = handleMap.get('test:noisy')!
      await fn(createMockEvent())

      expect(mockLogger.info).not.toHaveBeenCalled()
      expect(mockLogger.warn).not.toHaveBeenCalled()
      expect(mockLogger.error).not.toHaveBeenCalled()
    })
  })

  describe('sender validation', () => {
    it('throws when no window exists', async () => {
      mockGetWindow = () => null
      handle('test:no-window', () => 'never')
      const fn = handleMap.get('test:no-window')!

      await expect(fn(createMockEvent())).rejects.toThrow('Unauthorized')
    })

    it('throws when sender id does not match window id', async () => {
      mockGetWindow = () => createMockWindow({ id: 100 })
      handle('test:bad-sender', () => 'never')
      const fn = handleMap.get('test:bad-sender')!

      await expect(fn(createMockEvent(999))).rejects.toThrow('Unauthorized')
    })

    it('logs UnauthorizedSenderError as error (logLevel: error)', async () => {
      mockGetWindow = () => null
      handle('test:auth-error', () => 'never')
      const fn = handleMap.get('test:auth-error')!

      try {
        await fn(createMockEvent())
      } catch {
        /* expected */
      }

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('IPC UnauthorizedSenderError'),
        expect.any(Object)
      )
    })

    it('does not invoke the user handler when sender is unauthorized', async () => {
      mockGetWindow = () => null
      const userHandler = vi.fn()
      handle('test:not-called', userHandler)
      const fn = handleMap.get('test:not-called')!

      try {
        await fn(createMockEvent())
      } catch {
        /* expected */
      }
      expect(userHandler).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('translates BaseError(warn level) to its publicMessage and logs warn', async () => {
      handle('test:base-warn', () => {
        throw new TestErrorWarn('internal detail')
      })
      const fn = handleMap.get('test:base-warn')!

      await expect(fn(createMockEvent())).rejects.toThrow(
        'public warn message'
      )
      expect(mockLogger.warn).toHaveBeenCalled()
      expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('translates BaseError(error level) to its publicMessage and logs error', async () => {
      handle('test:base-error', () => {
        throw new TestErrorError('internal detail')
      })
      const fn = handleMap.get('test:base-error')!

      await expect(fn(createMockEvent())).rejects.toThrow(
        'public error message'
      )
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('translates ZodError to "Invalid input" and logs warn', async () => {
      const Schema = z.object({ name: z.string().min(1) })
      handle('test:zod', () => {
        Schema.parse({ name: '' })
      })
      const fn = handleMap.get('test:zod')!

      await expect(fn(createMockEvent())).rejects.toThrow('Invalid input')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('IPC validation failed'),
        expect.any(Object)
      )
    })

    it('throws a real ZodError when caught (sanity)', async () => {
      const Schema = z.string().min(5)
      let caught: unknown
      try {
        Schema.parse('hi')
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(ZodError)
    })

    it('translates unknown errors to "Internal error" and logs error', async () => {
      handle('test:unknown', () => {
        throw new TypeError('mysterious')
      })
      const fn = handleMap.get('test:unknown')!

      await expect(fn(createMockEvent())).rejects.toThrow('Internal error')
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error in IPC handler'),
        expect.any(Object)
      )
    })

    it('does not leak BaseError internal message to renderer', async () => {
      handle('test:no-leak', () => {
        throw new TestErrorWarn('SECRET_INTERNAL_DETAIL')
      })
      const fn = handleMap.get('test:no-leak')!

      // The handler is expected to re-throw. Capture the rejection
      // unconditionally and assert the sanitized message, so the assertion
      // runs on every invocation (no conditional expect).
      const invocation = fn(createMockEvent()) as Promise<unknown>
      const thrown: unknown = await invocation.then(
        () => new Error('expected handler to reject but it resolved'),
        (err: unknown) => err
      )
      expect(thrown).toBeInstanceOf(Error)
      expect((thrown as Error).message).not.toContain('SECRET_INTERNAL_DETAIL')
    })

    it('handles a thrown non-Error value as unknown error', async () => {
      handle('test:string-throw', () => {
        throw 'naked string' // intentional non-Error throw for coverage
      })
      const fn = handleMap.get('test:string-throw')!

      await expect(fn(createMockEvent())).rejects.toThrow('Internal error')
    })

    it('handles an async handler that rejects with BaseError', async () => {
      handle('test:async-base', async () => {
        throw new TestErrorWarn('async-internal')
      })
      const fn = handleMap.get('test:async-base')!

      await expect(fn(createMockEvent())).rejects.toThrow(
        'public warn message'
      )
    })

    it('falls back to err.message when err.stack is undefined', async () => {
      // Hit the (err.stack ?? err.message) branch. BaseError subclasses
      // normally get a stack from Error; explicitly strip it here.
      handle('test:no-stack', () => {
        const err = new TestErrorWarn('internal-no-stack')
        Object.defineProperty(err, 'stack', { value: undefined })
        throw err
      })
      const fn = handleMap.get('test:no-stack')!

      await expect(fn(createMockEvent())).rejects.toThrow(
        'public warn message'
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ error: 'internal-no-stack' })
      )
    })
  })
})

// ---------------------------------------------------------------------------
// sendToRenderer()
// ---------------------------------------------------------------------------
describe('transport.sendToRenderer()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the channel and payload to webContents when window exists', () => {
    const win = createMockWindow({ id: 5, destroyed: false })
    mockGetWindow = () => win

    sendToRenderer('test:msg', 'a', 1, { ok: true })

    const calls = (win as unknown as { __sendCalls: unknown[][] }).__sendCalls
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['test:msg', 'a', 1, { ok: true }])
  })

  it('is a silent no-op when getWindow returns null', () => {
    mockGetWindow = () => null
    expect(() => sendToRenderer('test:msg', 'payload')).not.toThrow()
  })

  it('is a silent no-op when the window is destroyed', () => {
    const win = createMockWindow({ destroyed: true })
    mockGetWindow = () => win

    sendToRenderer('test:msg', 'payload')

    const calls = (win as unknown as { __sendCalls: unknown[][] }).__sendCalls
    expect(calls).toHaveLength(0)
  })

  it('forwards zero-arg sends', () => {
    const win = createMockWindow()
    mockGetWindow = () => win

    sendToRenderer('test:noargs')

    const calls = (win as unknown as { __sendCalls: unknown[][] }).__sendCalls
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['test:noargs'])
  })

  it('forwards multi-arg sends in order', () => {
    const win = createMockWindow()
    mockGetWindow = () => win

    sendToRenderer('test:multi', 1, 2, 3, 4, 5)

    const calls = (win as unknown as { __sendCalls: unknown[][] }).__sendCalls
    expect(calls[0]).toEqual(['test:multi', 1, 2, 3, 4, 5])
  })

  it('does not crash if isDestroyed throws — defensive contract check', () => {
    // The current implementation calls isDestroyed before send. If isDestroyed
    // throws (e.g. window object torn down mid-call), the function will throw.
    // This test documents the current behavior so any future change is intentional.
    const win = {
      isDestroyed: vi.fn().mockImplementation(() => {
        throw new Error('window gone')
      }),
      webContents: { id: 1, send: vi.fn() }
    } as unknown as Electron.BrowserWindow
    mockGetWindow = () => win

    expect(() => sendToRenderer('test:torn-down')).toThrow('window gone')
  })
})

// Re-export class for the import-only check that catches accidental drift.
// `UnauthorizedSenderError` must remain a logLevel='error' BaseError so the
// transport's branch in handle() picks the right log path.
describe('UnauthorizedSenderError contract', () => {
  it('is a BaseError', () => {
    expect(new UnauthorizedSenderError()).toBeInstanceOf(BaseError)
  })

  it('has logLevel error', () => {
    expect(new UnauthorizedSenderError().logLevel).toBe('error')
  })

  it('exposes a publicMessage of "Unauthorized"', () => {
    expect(new UnauthorizedSenderError().publicMessage).toBe('Unauthorized')
  })
})
