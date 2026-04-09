import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Direct unit tests of the real logger module. Other test files mock @/main/lib/logger,
// so its actual format() helper is otherwise never executed -- coverage was 0 lines.
const { logger, setErrorSink } = await import('@/main/lib/logger')

describe('logger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // logger.info
  // -------------------------------------------------------------------------
  describe('info()', () => {
    it('writes a single-arg message to console.info when no context provided', () => {
      logger.info('hello')

      expect(infoSpy).toHaveBeenCalledTimes(1)
      const [msg, ...rest] = infoSpy.mock.calls[0]
      expect(msg).toMatch(/\[main\/info] hello$/)
      expect(rest).toHaveLength(0)
    })

    it('passes context as a second argument to console.info', () => {
      const ctx = { sessionId: 'abc' }
      logger.info('event', ctx)

      expect(infoSpy).toHaveBeenCalledTimes(1)
      const [msg, context] = infoSpy.mock.calls[0]
      expect(msg).toMatch(/\[main\/info] event$/)
      expect(context).toBe(ctx)
    })

    it('prefixes messages with an ISO timestamp', () => {
      logger.info('test')

      const [msg] = infoSpy.mock.calls[0] as [string]
      expect(msg).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[main\/info] test$/
      )
    })

    it('does not write to console.warn or console.error', () => {
      logger.info('msg')

      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // logger.warn
  // -------------------------------------------------------------------------
  describe('warn()', () => {
    it('writes to console.warn with the warn level prefix', () => {
      logger.warn('careful')

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const [msg] = warnSpy.mock.calls[0] as [string]
      expect(msg).toMatch(/\[main\/warn] careful$/)
    })

    it('attaches context object as second argument', () => {
      const ctx = { error: 'oops' }
      logger.warn('thing failed', ctx)

      const [, context] = warnSpy.mock.calls[0]
      expect(context).toBe(ctx)
    })

    it('does not write to console.info or console.error', () => {
      logger.warn('msg')

      expect(infoSpy).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // logger.error
  // -------------------------------------------------------------------------
  describe('error()', () => {
    it('writes to console.error with the error level prefix', () => {
      logger.error('boom')

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const [msg] = errorSpy.mock.calls[0] as [string]
      expect(msg).toMatch(/\[main\/error] boom$/)
    })

    it('attaches context object as second argument', () => {
      const ctx = { stack: 'trace' }
      logger.error('crash', ctx)

      const [, context] = errorSpy.mock.calls[0]
      expect(context).toBe(ctx)
    })

    it('omits the second argument when no context is given', () => {
      logger.error('lonely')

      const args = errorSpy.mock.calls[0]
      expect(args).toHaveLength(1)
    })

    it('does not write to console.info or console.warn', () => {
      logger.error('msg')

      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Format integrity
  // -------------------------------------------------------------------------
  describe('format', () => {
    it('handles empty message strings without crashing', () => {
      expect(() => { logger.info('') }).not.toThrow()

      const [msg] = infoSpy.mock.calls[0] as [string]
      expect(msg).toMatch(/\[main\/info] $/)
    })

    it('preserves multi-line message content verbatim', () => {
      logger.info('line1\nline2')

      const [msg] = infoSpy.mock.calls[0] as [string]
      expect(msg).toContain('line1\nline2')
    })

    it('does not stringify the context object — passes by reference', () => {
      const ctx = { circular: {} as Record<string, unknown> }
      ctx.circular.self = ctx

      // The logger should not throw on circular references because it doesn't
      // serialize the context — console handles that.
      expect(() => { logger.warn('circular', ctx) }).not.toThrow()

      const [, captured] = warnSpy.mock.calls[0]
      expect(captured).toBe(ctx)
    })

    it('treats undefined context as no context (single-arg call)', () => {
      logger.info('msg', undefined)

      const args = infoSpy.mock.calls[0]
      expect(args).toHaveLength(1)
    })

    it('treats empty object context as a context (two-arg call)', () => {
      logger.info('msg', {})

      const args = infoSpy.mock.calls[0]
      expect(args).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // setErrorSink + error sink wiring
  // -------------------------------------------------------------------------
  describe('setErrorSink', () => {
    afterEach(() => {
      // Always uninstall so one test's sink doesn't leak into the next.
      setErrorSink(null)
    })

    it('invokes the installed sink with the formatted line and context on error()', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      const ctx = { sessionId: 'sid-1' }
      logger.error('disk full', ctx)

      expect(sink).toHaveBeenCalledTimes(1)
      const [line, context] = sink.mock.calls[0] as [string, unknown]
      expect(line).toMatch(/\[main\/error] disk full$/)
      expect(context).toBe(ctx)
    })

    it('passes undefined context through to the sink when none is provided', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      logger.error('no ctx here')

      expect(sink).toHaveBeenCalledTimes(1)
      const [, context] = sink.mock.calls[0] as [string, unknown]
      expect(context).toBeUndefined()
    })

    it('does not invoke the sink on info() or warn()', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      logger.info('info message')
      logger.warn('warn message')

      expect(sink).not.toHaveBeenCalled()
    })

    it('swallows errors thrown by the sink so the logger itself never crashes', () => {
      setErrorSink(() => {
        throw new Error('sink kaput')
      })

      expect(() => {
        logger.error('should still reach console')
      }).not.toThrow()

      // console.error should still have been called — the sink failure
      // must not prevent the primary log output.
      expect(errorSpy).toHaveBeenCalled()
    })

    it('passing null uninstalls the sink', () => {
      const sink = vi.fn()
      setErrorSink(sink)
      logger.error('first')
      expect(sink).toHaveBeenCalledTimes(1)

      setErrorSink(null)
      logger.error('second')
      expect(sink).toHaveBeenCalledTimes(1)
    })

    it('replacing one sink with another uses only the latest', () => {
      const first = vi.fn()
      const second = vi.fn()
      setErrorSink(first)
      setErrorSink(second)

      logger.error('routed to second')

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)
    })

    it('normalizes Error values in context to stack-bearing strings for the sink', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      const err = new Error('disk full')
      logger.error('write failed', { reason: err, sessionId: 'sid-1' })

      const [, context] = sink.mock.calls[0] as [
        string,
        Record<string, unknown>
      ]
      expect(typeof context.reason).toBe('string')
      expect(context.reason).toContain('Error: disk full')
      // Non-Error values pass through unchanged.
      expect(context.sessionId).toBe('sid-1')
    })

    it('does not mutate the caller-supplied context when normalizing errors', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      const err = new Error('boom')
      const ctx = { reason: err, tag: 'a' }
      logger.error('failure', ctx)

      // Original reference still holds the Error instance.
      expect(ctx.reason).toBe(err)
    })

    it('passes context through untouched when no Error values are present', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      const ctx = { sessionId: 'sid-1', count: 42 }
      logger.error('plain context', ctx)

      const [, context] = sink.mock.calls[0] as [string, unknown]
      // Same reference — no copy was made when nothing needed normalizing.
      expect(context).toBe(ctx)
    })

    it('handles undefined context without copying', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      logger.error('no ctx')

      const [, context] = sink.mock.calls[0] as [string, unknown]
      expect(context).toBeUndefined()
    })

    it('handles Error values whose .stack is undefined (falls back to empty string)', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      const err = new Error('stackless')
      Object.defineProperty(err, 'stack', { value: undefined })
      logger.error('boom', { reason: err })

      const [, context] = sink.mock.calls[0] as [
        string,
        Record<string, unknown>
      ]
      // No trailing stack, but still the "<name>: <message>\n" prefix.
      expect(context.reason).toBe('Error: stackless\n')
    })

    it('console.error still receives the original (un-normalized) context', () => {
      const sink = vi.fn()
      setErrorSink(sink)

      const err = new Error('inner')
      logger.error('msg', { reason: err })

      // Console path receives the raw Error instance for DevTools inspection.
      const [, consoleCtx] = errorSpy.mock.calls[0] as [
        string,
        Record<string, unknown>
      ]
      expect(consoleCtx.reason).toBe(err)
    })
  })
})
