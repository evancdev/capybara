const ELECTRON_VARS = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_NO_ATTACH_CONSOLE'
])

/**
 * Returns a copy of process.env with Electron-specific vars removed and any
 * undefined entries filtered out. Pass this to any child process spawn so the
 * child doesn't try to behave like Electron just because it inherited the
 * parent's env. Non-mutating — process.env is left untouched.
 */
export function getCleanChildEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (ELECTRON_VARS.has(key)) continue
    env[key] = value
  }
  return env
}
