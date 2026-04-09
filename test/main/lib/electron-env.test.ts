import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getCleanChildEnv } from '@/main/lib/electron-env'

describe('getCleanChildEnv', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const electronVars = [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ASAR',
    'ELECTRON_NO_ATTACH_CONSOLE'
  ] as const

  beforeEach(() => {
    for (const key of electronVars) {
      savedEnv[key] = process.env[key]
    }
  })

  afterEach(() => {
    for (const key of electronVars) {
      if (savedEnv[key] === undefined) {
        process.env[key] = ''
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  it('returns an object', () => {
    const env = getCleanChildEnv()
    expect(typeof env).toBe('object')
    expect(env).not.toBeNull()
  })

  it('removes ELECTRON_RUN_AS_NODE', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    const env = getCleanChildEnv()
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('removes ELECTRON_NO_ASAR', () => {
    process.env.ELECTRON_NO_ASAR = '1'
    const env = getCleanChildEnv()
    expect(env.ELECTRON_NO_ASAR).toBeUndefined()
  })

  it('removes ELECTRON_NO_ATTACH_CONSOLE', () => {
    process.env.ELECTRON_NO_ATTACH_CONSOLE = '1'
    const env = getCleanChildEnv()
    expect(env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined()
  })

  it('removes all three Electron vars simultaneously', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.ELECTRON_NO_ASAR = '1'
    process.env.ELECTRON_NO_ATTACH_CONSOLE = '1'

    const env = getCleanChildEnv()

    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.ELECTRON_NO_ASAR).toBeUndefined()
    expect(env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined()
  })

  it('does not mutate process.env', () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    getCleanChildEnv()
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('preserves non-Electron env vars', () => {
    const env = getCleanChildEnv()
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('returns a fresh copy each call', () => {
    const a = getCleanChildEnv()
    const b = getCleanChildEnv()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  it('does not crash when Electron vars are absent', () => {
    for (const key of electronVars) {
      delete process.env[key]
    }
    expect(() => getCleanChildEnv()).not.toThrow()
  })

  it('filters out entries whose value is undefined', () => {
    // TypeScript treats process.env values as possibly undefined, so the
    // implementation defensively skips them. At runtime in Node this is hard
    // to reach naturally — force it by stubbing Object.entries to return an
    // undefined value for one key.
    const spy = vi.spyOn(Object, 'entries').mockReturnValueOnce([
      ['PATH', '/usr/bin'],
      ['UNDEF_KEY', undefined],
      ['HOME', '/Users/test']
    ])

    const env = getCleanChildEnv()

    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/test')
    expect(env).not.toHaveProperty('UNDEF_KEY')
    spy.mockRestore()
  })
})
