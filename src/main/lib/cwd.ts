import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { CwdDeps } from '@/main/types/cwd'
import { CwdValidationError } from '@/main/lib/errors'

/** Real Node APIs for validateCwd. Tests pass fakes instead. */
export const defaultCwdDeps: CwdDeps = {
  homedir: () => os.homedir(),
  stat: (p: string) => fsp.stat(p),
  resolve: (...paths: string[]) => path.resolve(...paths),
  realpath: (p: string) => fsp.realpath(p),
  sep: path.sep
}

/**
 * Confirms a directory is inside the user's home folder and actually exists.
 * Returns the resolved absolute path. Throws CwdValidationError on anything sketchy.
 *
 * Uses `realpath` on both the target and home so that a symlink inside $HOME
 * pointing at e.g. `/etc` cannot be used to escape the sandbox — we compare
 * the fully-dereferenced paths, not the lexical ones.
 */
export async function validateCwd(
  directory: string,
  deps: CwdDeps = defaultCwdDeps
): Promise<string> {
  const resolved = deps.resolve(directory)
  const home = deps.resolve(deps.homedir())

  let realResolved: string
  let realHome: string
  try {
    realResolved = await deps.realpath(resolved)
    realHome = await deps.realpath(home)
  } catch {
    throw new CwdValidationError('Invalid directory')
  }

  // On Windows (NTFS is case-insensitive), compare paths case-insensitively.
  const isWindows = deps.sep === '\\'
  const resolvedCmp = isWindows ? realResolved.toLowerCase() : realResolved
  const homeCmp = isWindows ? realHome.toLowerCase() : realHome

  if (resolvedCmp !== homeCmp && !resolvedCmp.startsWith(homeCmp + deps.sep)) {
    throw new CwdValidationError('Invalid directory')
  }

  let stat: { isDirectory: () => boolean }
  try {
    stat = await deps.stat(realResolved)
  } catch {
    throw new CwdValidationError('Invalid directory')
  }

  if (!stat.isDirectory()) {
    throw new CwdValidationError('Invalid directory')
  }
  return realResolved
}
