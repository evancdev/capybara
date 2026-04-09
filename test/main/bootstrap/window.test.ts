import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface FakeBrowserWindow {
  webContents: {
    id: number
    send: (channel: string, ...args: unknown[]) => void
  }
  loadURL: (url: string) => Promise<void>
  loadFile: (file: string) => Promise<void>
  on: (event: string, handler: () => void) => void
  isDestroyed: () => boolean
  __closedHandler?: () => void
  __loadCalls: { kind: 'url' | 'file'; arg: string }[]
}

let nextWebContentsId = 1
const createdWindows: FakeBrowserWindow[] = []
let loadShouldReject = false

const BrowserWindowMock = vi.fn(function (
  this: unknown,
  _opts: Record<string, unknown>
) {
  const win: FakeBrowserWindow = {
    webContents: {
      id: nextWebContentsId++,
      send: vi.fn()
    },
    loadURL: vi.fn(async (url: string) => {
      win.__loadCalls.push({ kind: 'url', arg: url })
      if (loadShouldReject) throw new Error('load failed')
    }),
    loadFile: vi.fn(async (file: string) => {
      win.__loadCalls.push({ kind: 'file', arg: file })
      if (loadShouldReject) throw new Error('load failed')
    }),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'closed') {
        win.__closedHandler = handler
      }
    }),
    isDestroyed: vi.fn().mockReturnValue(false),
    __loadCalls: []
  }
  createdWindows.push(win)
  return win
})

const mockApp = {
  isPackaged: false
}

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: BrowserWindowMock
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('bootstrap/window — getPublicPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWindows.length = 0
    nextWebContentsId = 1
    mockApp.isPackaged = false
    loadShouldReject = false
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.ELECTRON_RENDERER_URL
  })

  it('returns process.resourcesPath when app is packaged', async () => {
    mockApp.isPackaged = true
    const originalResourcesPath = (process as { resourcesPath?: string })
      .resourcesPath
    ;(process as { resourcesPath?: string }).resourcesPath = '/packaged/resources'

    const { getPublicPath } = await import('@/main/bootstrap/window')

    expect(getPublicPath()).toBe('/packaged/resources')

    if (originalResourcesPath !== undefined) {
      ;(process as { resourcesPath?: string }).resourcesPath =
        originalResourcesPath
    } else {
      delete (process as { resourcesPath?: string }).resourcesPath
    }
  })

  it('returns a path containing "public" when app is in development', async () => {
    mockApp.isPackaged = false
    const { getPublicPath } = await import('@/main/bootstrap/window')

    const path = getPublicPath()
    expect(path).toContain('public')
  })
})

describe('bootstrap/window — createWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWindows.length = 0
    nextWebContentsId = 1
    mockApp.isPackaged = false
    loadShouldReject = false
    vi.resetModules()
    delete process.env.ELECTRON_RENDERER_URL
  })

  it('constructs a BrowserWindow on first call', async () => {
    const { createWindow } = await import('@/main/bootstrap/window')

    const win = createWindow()

    expect(BrowserWindowMock).toHaveBeenCalledTimes(1)
    expect(win).toBeDefined()
  })

  it('passes secure webPreferences (no nodeIntegration, contextIsolation enabled, sandbox)', async () => {
    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    const callArgs = BrowserWindowMock.mock.calls[0][0] as {
      webPreferences: {
        nodeIntegration: boolean
        contextIsolation: boolean
        sandbox: boolean
        webviewTag: boolean
      }
    }
    expect(callArgs.webPreferences.nodeIntegration).toBe(false)
    expect(callArgs.webPreferences.contextIsolation).toBe(true)
    expect(callArgs.webPreferences.sandbox).toBe(true)
    expect(callArgs.webPreferences.webviewTag).toBe(false)
  })

  it('returns the same window on subsequent calls (singleton)', async () => {
    const { createWindow } = await import('@/main/bootstrap/window')
    const w1 = createWindow()
    const w2 = createWindow()

    expect(w1).toBe(w2)
    expect(BrowserWindowMock).toHaveBeenCalledTimes(1)
  })

  it('reconstructs a new window when the previous one was destroyed', async () => {
    const { createWindow } = await import('@/main/bootstrap/window')
    const w1 = createWindow()
    ;(w1 as unknown as FakeBrowserWindow).isDestroyed = () => true

    const w2 = createWindow()

    expect(w1).not.toBe(w2)
    expect(BrowserWindowMock).toHaveBeenCalledTimes(2)
  })

  it('loads the renderer URL in dev when ELECTRON_RENDERER_URL is set', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    mockApp.isPackaged = false

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    // Allow microtask to flush
    await new Promise((r) => setTimeout(r, 5))

    const win = createdWindows[0]
    expect(win.__loadCalls).toHaveLength(1)
    expect(win.__loadCalls[0]).toEqual({
      kind: 'url',
      arg: 'http://localhost:5173'
    })
  })

  it('loads the bundled renderer file when packaged', async () => {
    mockApp.isPackaged = true
    ;(process as { resourcesPath?: string }).resourcesPath = '/packaged/resources'

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    await new Promise((r) => setTimeout(r, 5))

    const win = createdWindows[0]
    expect(win.__loadCalls[0].kind).toBe('file')
    expect(win.__loadCalls[0].arg).toContain(join('renderer', 'index.html'))

    delete (process as { resourcesPath?: string }).resourcesPath
  })

  it('loads the renderer file when ELECTRON_RENDERER_URL is empty string in dev', async () => {
    process.env.ELECTRON_RENDERER_URL = ''
    mockApp.isPackaged = false

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    await new Promise((r) => setTimeout(r, 5))

    const win = createdWindows[0]
    expect(win.__loadCalls[0].kind).toBe('file')
  })

  it('logs the load failure when loadURL rejects', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:9999'
    mockApp.isPackaged = false
    loadShouldReject = true

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    // Wait for the rejected promise to surface to the .catch
    await new Promise((r) => setTimeout(r, 10))

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to load window content from "http://localhost:9999"'
      ),
      expect.any(Object)
    )
  })

  it('logs renderer/index.html as the failure target when loadFile rejects', async () => {
    mockApp.isPackaged = true
    ;(process as { resourcesPath?: string }).resourcesPath = '/packaged/resources'
    loadShouldReject = true

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    await new Promise((r) => setTimeout(r, 10))

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('renderer/index.html'),
      expect.any(Object)
    )

    delete (process as { resourcesPath?: string }).resourcesPath
  })

  it('registers a "closed" handler that resets the singleton', async () => {
    const { createWindow, getWindow } = await import('@/main/bootstrap/window')
    const win = createWindow()
    const fakeWin = win as unknown as FakeBrowserWindow

    expect(getWindow()).toBe(win)
    expect(fakeWin.__closedHandler).toBeDefined()

    fakeWin.__closedHandler!()

    expect(getWindow()).toBeNull()
  })

  it('uses .ico icon on Windows', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true
    })

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    const opts = BrowserWindowMock.mock.calls[0][0] as { icon: string }
    expect(opts.icon).toMatch(/\.ico$/)

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true
    })
  })

  it('uses .png icon on darwin', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true
    })

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    const opts = BrowserWindowMock.mock.calls[0][0] as { icon: string }
    expect(opts.icon).toMatch(/\.png$/)
  })

  it('uses .png icon on linux (default branch)', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true
    })

    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    const opts = BrowserWindowMock.mock.calls[0][0] as { icon: string }
    expect(opts.icon).toMatch(/\.png$/)

    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true
    })
  })

  it('sets a 1200x800 default size and "Capybara" title', async () => {
    const { createWindow } = await import('@/main/bootstrap/window')
    createWindow()

    const opts = BrowserWindowMock.mock.calls[0][0] as {
      width: number
      height: number
      title: string
      titleBarStyle: string
    }
    expect(opts.width).toBe(1200)
    expect(opts.height).toBe(800)
    expect(opts.title).toBe('Capybara')
    expect(opts.titleBarStyle).toBe('hiddenInset')
  })
})

describe('bootstrap/window — getWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdWindows.length = 0
    nextWebContentsId = 1
    mockApp.isPackaged = false
    vi.resetModules()
  })

  it('returns null before any window is created', async () => {
    const { getWindow } = await import('@/main/bootstrap/window')
    expect(getWindow()).toBeNull()
  })

  it('returns the constructed window after createWindow', async () => {
    const { createWindow, getWindow } = await import('@/main/bootstrap/window')
    const win = createWindow()
    expect(getWindow()).toBe(win)
  })

  it('returns null after the closed handler runs', async () => {
    const { createWindow, getWindow } = await import('@/main/bootstrap/window')
    const win = createWindow()
    const fakeWin = win as unknown as FakeBrowserWindow

    fakeWin.__closedHandler!()
    expect(getWindow()).toBeNull()
  })
})
