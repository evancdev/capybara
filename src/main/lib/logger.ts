/* eslint-disable no-console */
type LogContext = Record<string, unknown>

<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
=======
>>>>>>> Stashed changes
/**
 * Optional sink for error-level output. The composition root (index.ts)
 * installs a file-backed sink at startup so every logger.error call also
 * appends a formatted line to disk. Kept as a module-level callback (not
 * injected per-call) so existing `import { logger }` call sites don't have
 * to thread a handle through every service.
 */
type ErrorSink = (line: string, context: LogContext | undefined) => void
let errorSink: ErrorSink | null = null

/** Install the error sink. Pass null to uninstall (tests / shutdown). */
export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink
}

/**
 * Shallow-copy a context, replacing top-level Error values with a
 * stack-bearing string. JSON.stringify otherwise emits `{}` for Errors,
 * which loses stacks in the file sink. Only applied to the sink path so
 * console output and in-process callers still receive the original object.
 */
function normalizeErrorsInContext(
  context: LogContext | undefined
): LogContext | undefined {
  if (!context) return context
  let copy: LogContext | undefined
  for (const key of Object.keys(context)) {
    const value = context[key]
    if (value instanceof Error) {
<<<<<<< Updated upstream
      if (!copy) copy = { ...context }
=======
      copy ??= { ...context }
>>>>>>> Stashed changes
      copy[key] = `${value.name}: ${value.message}\n${value.stack ?? ''}`
    }
  }
  return copy ?? context
}

<<<<<<< Updated upstream
=======
>>>>>>> Stashed changes
>>>>>>> Stashed changes
function format(
  level: string,
  message: string,
  context?: LogContext
): [string, ...unknown[]] {
  const timestamp = new Date().toISOString()
  const prefix = `${timestamp} [main/${level}]`
  return context ? [`${prefix} ${message}`, context] : [`${prefix} ${message}`]
}

export const logger = {
  info(message: string, context?: LogContext): void {
    console.info(...format('info', message, context))
  },

  warn(message: string, context?: LogContext): void {
    console.warn(...format('warn', message, context))
  },

  error(message: string, context?: LogContext): void {
    const formatted = format('error', message, context)
    console.error(...formatted)
    if (errorSink) {
      try {
        errorSink(formatted[0], normalizeErrorsInContext(context))
      } catch {
        // Never let a broken sink crash the logger itself.
      }
    }
  }
}
