import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import { validateCwd, defaultCwdDeps } from '@/main/lib/cwd'
import { CwdValidationError } from '@/main/lib/errors'
import type { CwdDeps } from '@/main/types/cwd'

/**
 * Direct unit tests for validateCwd. The function is also exercised
 * through the IPC handler tests, but those use only one platform's
 * resolve/sep at a time. Here we drive both POSIX and Windows path
 * semantics deterministically by injecting CwdDeps.
 */

function makePosixDeps(overrides: Partial<CwdDeps> = {}): CwdDeps {
  return {
    homedir: () => '/Users/test',
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    resolve: (...paths: string[]) => path.posix.resolve(...paths),
    realpath: (p: string) => Promise.resolve(p),
    sep: '/',
    ...overrides
  }
}

function makeWindowsDeps(overrides: Partial<CwdDeps> = {}): CwdDeps {
  return {
    homedir: () => 'C:\\Users\\test',
    stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    resolve: (...paths: string[]) => path.win32.resolve(...paths),
    realpath: (p: string) => Promise.resolve(p),
    sep: '\\',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// defaultCwdDeps
// ---------------------------------------------------------------------------
describe('defaultCwdDeps', () => {
  it('exposes a homedir function', () => {
    expect(typeof defaultCwdDeps.homedir).toBe('function')
    expect(typeof defaultCwdDeps.homedir()).toBe('string')
  })

  it('exposes a stat function that returns a promise', async () => {
    expect(typeof defaultCwdDeps.stat).toBe('function')
    // Actually invoke stat on a path we know exists (the repo root).
    const result = await defaultCwdDeps.stat(process.cwd())
    expect(typeof result.isDirectory).toBe('function')
    expect(result.isDirectory()).toBe(true)
  })

  it('exposes a stat function that rejects on missing paths', async () => {
    await expect(
      defaultCwdDeps.stat('/this/definitely/does/not/exist/anywhere')
    ).rejects.toBeDefined()
  })

  it('exposes a resolve function', () => {
    expect(typeof defaultCwdDeps.resolve).toBe('function')
    expect(defaultCwdDeps.resolve('/tmp', 'foo')).toBe(
      path.resolve('/tmp', 'foo')
    )
  })

  it('exposes path.sep', () => {
    expect(defaultCwdDeps.sep).toBe(path.sep)
  })

  it('exposes a realpath function', async () => {
    expect(typeof defaultCwdDeps.realpath).toBe('function')
    const result = await defaultCwdDeps.realpath(process.cwd())
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// validateCwd — POSIX
// ---------------------------------------------------------------------------
describe('validateCwd (POSIX)', () => {
  it('accepts a path equal to $HOME', async () => {
    const deps = makePosixDeps()
    await expect(validateCwd('/Users/test', deps)).resolves.toBe('/Users/test')
  })

  it('accepts a child of $HOME', async () => {
    const deps = makePosixDeps()
    await expect(validateCwd('/Users/test/project', deps)).resolves.toBe(
      '/Users/test/project'
    )
  })

  it('accepts a deeply nested child', async () => {
    const deps = makePosixDeps()
    await expect(
      validateCwd('/Users/test/a/b/c/d/e/f', deps)
    ).resolves.toBe('/Users/test/a/b/c/d/e/f')
  })

  it('returns the resolved path (not the input)', async () => {
    const deps = makePosixDeps()
    const result = await validateCwd('/Users/test/./project/../project', deps)
    expect(result).toBe('/Users/test/project')
  })

  it('rejects paths outside $HOME with CwdValidationError', async () => {
    const deps = makePosixDeps()
    await expect(validateCwd('/etc', deps)).rejects.toBeInstanceOf(
      CwdValidationError
    )
  })

  it('rejects /tmp', async () => {
    const deps = makePosixDeps()
    await expect(validateCwd('/tmp', deps)).rejects.toBeInstanceOf(
      CwdValidationError
    )
  })

  it('rejects path traversal back to a forbidden directory', async () => {
    const deps = makePosixDeps()
    await expect(
      validateCwd('/Users/test/../../etc', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects home prefix attack like /Users/testevil', async () => {
    const deps = makePosixDeps()
    await expect(
      validateCwd('/Users/testevil/project', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects a short prefix where home is /root and input is /rootkit', async () => {
    const deps = makePosixDeps({ homedir: () => '/root' })
    await expect(validateCwd('/rootkit/x', deps)).rejects.toBeInstanceOf(
      CwdValidationError
    )
  })

  it('rejects when stat throws ENOENT', async () => {
    const deps = makePosixDeps({
      stat: vi.fn().mockRejectedValue(new Error('ENOENT'))
    })
    await expect(
      validateCwd('/Users/test/missing', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects when stat returns a non-directory', async () => {
    const deps = makePosixDeps({
      stat: vi.fn().mockResolvedValue({ isDirectory: () => false })
    })
    await expect(
      validateCwd('/Users/test/file.txt', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('does not reject paths whose case differs from home (case-sensitive on POSIX)', async () => {
    const deps = makePosixDeps()
    // Linux/macOS treats this as a different directory, so it should NOT match $HOME
    // and should fall outside the prefix.
    await expect(
      validateCwd('/USERS/test/project', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('uses the resolve dep for home, normalizing trailing slashes', async () => {
    const deps = makePosixDeps({ homedir: () => '/Users/test/' })
    await expect(validateCwd('/Users/test/x', deps)).resolves.toBe(
      '/Users/test/x'
    )
  })

  it('rejects empty string input as outside home', async () => {
    const deps = makePosixDeps()
    // path.posix.resolve('') === process.cwd(), which on the host machine
    // is unlikely to be /Users/test, so this should reject.
    await expect(validateCwd('', deps)).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects a symlink inside $HOME that points outside $HOME', async () => {
    // The lexical path looks fine — it's under /Users/test — but realpath
    // reveals the symlink target is /etc, which is outside the sandbox.
    const deps = makePosixDeps({
      realpath: (p: string) => {
        if (p === '/Users/test/evil-link') return Promise.resolve('/etc')
        return Promise.resolve(p)
      }
    })
    await expect(
      validateCwd('/Users/test/evil-link', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('returns the dereferenced realpath when a symlink stays inside $HOME', async () => {
    const deps = makePosixDeps({
      realpath: (p: string) => {
        if (p === '/Users/test/link-to-project') {
          return Promise.resolve('/Users/test/project')
        }
        return Promise.resolve(p)
      }
    })
    await expect(
      validateCwd('/Users/test/link-to-project', deps)
    ).resolves.toBe('/Users/test/project')
  })

  it('rejects when realpath itself throws (broken symlink)', async () => {
    const deps = makePosixDeps({
      realpath: vi.fn().mockRejectedValue(new Error('ENOENT'))
    })
    await expect(
      validateCwd('/Users/test/broken', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })
})

// ---------------------------------------------------------------------------
// validateCwd — Windows
// ---------------------------------------------------------------------------
describe('validateCwd (Windows)', () => {
  it('accepts a path equal to home (exact case)', async () => {
    const deps = makeWindowsDeps()
    await expect(validateCwd('C:\\Users\\test', deps)).resolves.toBe(
      'C:\\Users\\test'
    )
  })

  it('accepts a path equal to home (different case)', async () => {
    const deps = makeWindowsDeps()
    await expect(validateCwd('c:\\users\\TEST', deps)).resolves.toBe(
      'c:\\users\\TEST'
    )
  })

  it('accepts a child of home with mixed case', async () => {
    const deps = makeWindowsDeps()
    await expect(
      validateCwd('C:\\USERS\\Test\\project', deps)
    ).resolves.toBe('C:\\USERS\\Test\\project')
  })

  it('accepts a child with mixed forward and backslashes', async () => {
    const deps = makeWindowsDeps()
    // path.win32.resolve normalizes / to \
    await expect(
      validateCwd('C:\\Users\\test/project', deps)
    ).resolves.toBe('C:\\Users\\test\\project')
  })

  it('rejects a path on a different drive', async () => {
    const deps = makeWindowsDeps()
    await expect(
      validateCwd('D:\\Users\\test\\project', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects a sibling that shares a prefix (testevil)', async () => {
    const deps = makeWindowsDeps()
    await expect(
      validateCwd('C:\\Users\\testevil\\project', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects a sibling that shares a prefix with different case', async () => {
    const deps = makeWindowsDeps()
    await expect(
      validateCwd('C:\\USERS\\TESTEVIL\\project', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects backslash traversal escaping home', async () => {
    const deps = makeWindowsDeps()
    await expect(
      validateCwd('C:\\Users\\test\\..\\admin', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects when stat fails on Windows path', async () => {
    const deps = makeWindowsDeps({
      stat: vi.fn().mockRejectedValue(new Error('ENOENT'))
    })
    await expect(
      validateCwd('C:\\Users\\test\\missing', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })

  it('rejects non-directory targets on Windows', async () => {
    const deps = makeWindowsDeps({
      stat: vi.fn().mockResolvedValue({ isDirectory: () => false })
    })
    await expect(
      validateCwd('C:\\Users\\test\\file.txt', deps)
    ).rejects.toBeInstanceOf(CwdValidationError)
  })
})
