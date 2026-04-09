import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Logger + errors
// ---------------------------------------------------------------------------
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

const { MAIN_COMMANDS } = await import('@/main/services/slash-commands')
const { InvalidCommandArgsError } = await import('@/main/lib/errors')
import type {
  MainCommandContext
} from '@/main/services/slash-commands'
import type { ClaudeConnection } from '@/main/claude/connection'
import type { SessionService } from '@/main/services/session'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------
function makeConnection(): {
  connection: ClaudeConnection
  send: ReturnType<typeof vi.fn>
  setModel: ReturnType<typeof vi.fn>
  setPermissionMode: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  const setModel = vi.fn()
  const setPermissionMode = vi.fn()
  return {
    connection: {
      send,
      setModel,
      setPermissionMode
    } as unknown as ClaudeConnection,
    send,
    setModel,
    setPermissionMode
  }
}

function makeSessionService(nextId = 'new-sid') {
  const destroy = vi.fn()
  const create = vi.fn().mockResolvedValue({
    id: nextId,
    status: 'running',
    exitCode: null,
    createdAt: Date.now(),
    permissionMode: 'default',
    metadata: {}
  })
  const notifyMetadataUpdated = vi.fn()
  return {
    service: { destroy, create, notifyMetadataUpdated } as unknown as SessionService,
    destroy,
    create,
    notifyMetadataUpdated
  }
}

function makeCtx(
  overrides: Partial<MainCommandContext> = {}
): MainCommandContext {
  const { connection } = makeConnection()
  const { service } = makeSessionService()
  return {
    sessionId: 'sid-1',
    cwd: '/Users/test/project',
    args: [],
    sessionService: service,
    connection,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// /compact
// ---------------------------------------------------------------------------
describe('MAIN_COMMANDS.compact', () => {
  it('sends a summarize prompt to the connection', async () => {
    const { connection, send } = makeConnection()
    const ctx = makeCtx({ connection })

    const result = await MAIN_COMMANDS.compact.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [text] = send.mock.calls[0] as [string]
    expect(text.toLowerCase()).toContain('summarize')
    expect(result).toEqual({})
  })

  it('does not touch the session service', async () => {
    const { connection } = makeConnection()
    const { service, destroy, create } = makeSessionService()
    const ctx = makeCtx({ connection, sessionService: service })

    await MAIN_COMMANDS.compact.handler(ctx)

    expect(destroy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// /model <name>
// ---------------------------------------------------------------------------
describe('MAIN_COMMANDS.model', () => {
  it('calls connection.setModel with the name', async () => {
    const { connection, setModel } = makeConnection()
    const ctx = makeCtx({ connection, args: ['claude-opus-4-6'] })

    const result = await MAIN_COMMANDS.model.handler(ctx)

    expect(setModel).toHaveBeenCalledWith('claude-opus-4-6')
    expect(result).toEqual({})
  })

  it('trims whitespace around the model name', async () => {
    const { connection, setModel } = makeConnection()
    const ctx = makeCtx({ connection, args: ['  claude-sonnet  '] })

    await MAIN_COMMANDS.model.handler(ctx)

    expect(setModel).toHaveBeenCalledWith('claude-sonnet')
  })

  it('throws InvalidCommandArgsError when args is empty', async () => {
    const { connection, setModel } = makeConnection()
    const ctx = makeCtx({ connection, args: [] })

    expect(() => MAIN_COMMANDS.model.handler(ctx)).toThrow(
      InvalidCommandArgsError
    )
    expect(setModel).not.toHaveBeenCalled()
  })

  it('throws InvalidCommandArgsError when first arg is an empty string', async () => {
    const { connection, setModel } = makeConnection()
    const ctx = makeCtx({ connection, args: [''] })

    expect(() => MAIN_COMMANDS.model.handler(ctx)).toThrow(
      InvalidCommandArgsError
    )
    expect(setModel).not.toHaveBeenCalled()
  })

  it('throws InvalidCommandArgsError when first arg is whitespace only', async () => {
    const { connection, setModel } = makeConnection()
    const ctx = makeCtx({ connection, args: ['   '] })

    expect(() => MAIN_COMMANDS.model.handler(ctx)).toThrow(
      InvalidCommandArgsError
    )
    expect(setModel).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// /init
// ---------------------------------------------------------------------------
describe('MAIN_COMMANDS.init', () => {
  it('sends a CLAUDE.md analyze prompt to the connection', async () => {
    const { connection, send } = makeConnection()
    const ctx = makeCtx({ connection })

    const result = await MAIN_COMMANDS.init.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [text] = send.mock.calls[0] as [string]
    expect(text).toContain('CLAUDE.md')
    expect(text.toLowerCase()).toContain('analyze')
    expect(result).toEqual({})
  })

  it('ignores extra args and does not touch the session service', async () => {
    const { connection, send } = makeConnection()
    const { service, destroy, create } = makeSessionService()
    const ctx = makeCtx({
      connection,
      sessionService: service,
      args: ['ignored']
    })

    const result = await MAIN_COMMANDS.init.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    expect(destroy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// /review
// ---------------------------------------------------------------------------
describe('MAIN_COMMANDS.review', () => {
  it('sends a review/diff prompt to the connection', async () => {
    const { connection, send } = makeConnection()
    const ctx = makeCtx({ connection })

    const result = await MAIN_COMMANDS.review.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    const [text] = send.mock.calls[0] as [string]
    expect(text.toLowerCase()).toContain('review')
    expect(text.toLowerCase()).toContain('diff')
    expect(result).toEqual({})
  })

  it('ignores extra args and does not touch the session service', async () => {
    const { connection, send } = makeConnection()
    const { service, destroy, create } = makeSessionService()
    const ctx = makeCtx({
      connection,
      sessionService: service,
      args: ['ignored']
    })

    const result = await MAIN_COMMANDS.review.handler(ctx)

    expect(send).toHaveBeenCalledTimes(1)
    expect(destroy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// /init and /review — prompt content and arg-handling edge cases
// ---------------------------------------------------------------------------
describe('MAIN_COMMANDS.init directive phrasing', () => {
  it('prompt mentions project root, build/test/lint commands, and context usage', async () => {
    const { connection, send } = makeConnection()
    const ctx = makeCtx({ connection })
    await MAIN_COMMANDS.init.handler(ctx)
    const [text] = send.mock.calls[0] as [string]
    expect(text).toContain('project root')
    expect(text.toLowerCase()).toContain('build')
    expect(text.toLowerCase()).toContain('test')
    expect(text.toLowerCase()).toContain('lint')
    expect(text.toLowerCase()).toContain('context')
  })

  it('ignores multi-token args entirely', async () => {
    const { connection, send } = makeConnection()
    const { service, destroy, create } = makeSessionService()
    const ctx = makeCtx({
      connection,
      sessionService: service,
      args: ['foo', 'bar', 'baz']
    })
    await MAIN_COMMANDS.init.handler(ctx)
    expect(send).toHaveBeenCalledTimes(1)
    const [text] = send.mock.calls[0] as [string]
    // None of the user-supplied tokens should leak into the prompt.
    expect(text).not.toContain('foo')
    expect(text).not.toContain('bar')
    expect(text).not.toContain('baz')
    expect(destroy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('MAIN_COMMANDS.review directive phrasing', () => {
  it('prompt asks for bugs, security, performance, and style checks with file/line citations', async () => {
    const { connection, send } = makeConnection()
    const ctx = makeCtx({ connection })
    await MAIN_COMMANDS.review.handler(ctx)
    const [text] = send.mock.calls[0] as [string]
    const lower = text.toLowerCase()
    expect(lower).toContain('bug')
    expect(lower).toContain('security')
    expect(lower).toContain('performance')
    expect(lower).toContain('style')
    expect(lower).toContain('line')
  })

  it('ignores multi-token args entirely', async () => {
    const { connection, send } = makeConnection()
    const { service, destroy, create } = makeSessionService()
    const ctx = makeCtx({
      connection,
      sessionService: service,
      args: ['--deep', 'HEAD~3', 'extra']
    })
    await MAIN_COMMANDS.review.handler(ctx)
    expect(send).toHaveBeenCalledTimes(1)
    const [text] = send.mock.calls[0] as [string]
    expect(text).not.toContain('--deep')
    expect(text).not.toContain('HEAD~3')
    expect(text).not.toContain('extra')
    expect(destroy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})

