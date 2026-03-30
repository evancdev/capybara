/* eslint-disable no-console */
type LogContext = Record<string, unknown>

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
    console.error(...format('error', message, context))
  }
}
