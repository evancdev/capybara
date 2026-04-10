import { describe, it, expect } from 'vitest'
import {
  parseSlashInput,
  findSlashCommand,
  SLASH_COMMANDS
} from '@/shared/types/commands'

// ---------------------------------------------------------------------------
// parseSlashInput
// ---------------------------------------------------------------------------
describe('parseSlashInput', () => {
  it('parses a bare slash command with no args', () => {
    expect(parseSlashInput('/compact')).toEqual({ name: 'compact', args: [] })
  })

  it('parses a command with a single arg', () => {
    expect(parseSlashInput('/model claude-opus-4-6')).toEqual({
      name: 'model',
      args: ['claude-opus-4-6']
    })
  })

  it('keeps a model identifier intact as a single arg token', () => {
    expect(parseSlashInput('/model claude-opus-4-6')).toEqual({
      name: 'model',
      args: ['claude-opus-4-6']
    })
  })

  it('returns null for non-slash input', () => {
    expect(parseSlashInput('foo')).toBeNull()
  })

  it('returns null for a bare slash', () => {
    expect(parseSlashInput('/')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseSlashInput('')).toBeNull()
  })

  it('returns null for whitespace only', () => {
    expect(parseSlashInput('   ')).toBeNull()
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseSlashInput('   /compact   ')).toEqual({
      name: 'compact',
      args: []
    })
  })

  it('lowercases the command name', () => {
    expect(parseSlashInput('/COMPACT')).toEqual({ name: 'compact', args: [] })
  })

  it('splits multiple args on whitespace', () => {
    expect(parseSlashInput('/foo a b c')).toEqual({
      name: 'foo',
      args: ['a', 'b', 'c']
    })
  })

  it('collapses runs of whitespace between args', () => {
    expect(parseSlashInput('/foo   a    b')).toEqual({
      name: 'foo',
      args: ['a', 'b']
    })
  })
})

// ---------------------------------------------------------------------------
// findSlashCommand
// ---------------------------------------------------------------------------
describe('findSlashCommand', () => {
  it('returns the spec for a known command by lowercase name', () => {
    const spec = findSlashCommand('compact')
    expect(spec).toBeDefined()
    expect(spec?.name).toBe('compact')
    expect(spec?.scope).toBe('main')
  })

  it('matches case-insensitively', () => {
    const spec = findSlashCommand('COMPACT')
    expect(spec?.name).toBe('compact')
  })

  it('returns undefined for an unknown name', () => {
    expect(findSlashCommand('nope')).toBeUndefined()
  })

  it('returns the main-scoped spec for /model', () => {
    const spec = findSlashCommand('model')
    expect(spec?.scope).toBe('main')
  })

  it('returns the main-scoped spec for /init', () => {
    const spec = findSlashCommand('init')
    expect(spec).toBeDefined()
    expect(spec?.name).toBe('init')
    expect(spec?.scope).toBe('main')
  })

  it('returns the main-scoped spec for /review', () => {
    const spec = findSlashCommand('review')
    expect(spec).toBeDefined()
    expect(spec?.name).toBe('review')
    expect(spec?.scope).toBe('main')
  })

  it('matches the kept commands case-insensitively (uppercase variants)', () => {
    expect(findSlashCommand('COMPACT')?.name).toBe('compact')
    expect(findSlashCommand('Model')?.name).toBe('model')
    expect(findSlashCommand('INIT')?.name).toBe('init')
    expect(findSlashCommand('Review')?.name).toBe('review')
  })

  it('exposes every expected slash command (presence-based)', () => {
    // Presence-based assertion so adding future commands does not break
    // this test. Each entry here must exist in SLASH_COMMANDS.
    const expected: { name: string; scope: 'renderer' | 'main' }[] = [
      { name: 'compact', scope: 'main' },
      { name: 'model', scope: 'main' },
      { name: 'init', scope: 'main' },
      { name: 'review', scope: 'main' }
    ]
    for (const { name, scope } of expected) {
      const spec = findSlashCommand(name)
      expect(spec, `missing spec for /${name}`).toBeDefined()
      expect(spec?.scope).toBe(scope)
    }
  })

  it('does not expose any deleted commands', () => {
    const deleted = [
      'help',
      'clear',
      'mode',
      'new',
      'status',
      'cost',
      'theme',
      'config',
      'keybindings',
      'resume'
    ]
    for (const name of deleted) {
      expect(findSlashCommand(name), `unexpected spec for /${name}`).toBeUndefined()
    }
  })

  it('contains exactly the five kept commands', () => {
    expect(SLASH_COMMANDS.map((c) => c.name).sort()).toEqual(
      ['compact', 'effort', 'init', 'model', 'review']
    )
  })
})

// ---------------------------------------------------------------------------
// parseSlashInput — kept-command integration
// ---------------------------------------------------------------------------
describe('parseSlashInput — kept commands', () => {
  it('parses /COMPACT (uppercase) with name lowercased', () => {
    expect(parseSlashInput('/COMPACT')).toEqual({ name: 'compact', args: [] })
  })

  it('parses /review with trailing whitespace', () => {
    expect(parseSlashInput('/review   ')).toEqual({
      name: 'review',
      args: []
    })
  })

  it('parses /init with extra args (caller is responsible for ignoring them)', () => {
    expect(parseSlashInput('/init foo bar')).toEqual({
      name: 'init',
      args: ['foo', 'bar']
    })
  })

  it('parses /review with extra args', () => {
    expect(parseSlashInput('/review HEAD~3')).toEqual({
      name: 'review',
      args: ['HEAD~3']
    })
  })
})

// ---------------------------------------------------------------------------
// parseSlashInput — edge cases (unicode, special chars, boundary inputs)
// ---------------------------------------------------------------------------
describe('parseSlashInput — edge cases', () => {
  it('handles unicode characters in args', () => {
    expect(parseSlashInput('/model claude-\u00e9')).toEqual({
      name: 'model',
      args: ['claude-\u00e9']
    })
  })

  it('handles emoji in args', () => {
    expect(parseSlashInput('/review \u{1F680}')).toEqual({
      name: 'review',
      args: ['\u{1F680}']
    })
  })

  it('handles multiple spaces between slash and command name', () => {
    // trim() + slice(1).trim() means "/ compact" should parse since
    // the body is "compact" after stripping the slash and trimming.
    expect(parseSlashInput('/  compact')).toEqual({
      name: 'compact',
      args: []
    })
  })

  it('handles tab characters between args', () => {
    // split(/\\s+/) splits on tabs too
    expect(parseSlashInput('/model\tclaude-opus-4-6')).toEqual({
      name: 'model',
      args: ['claude-opus-4-6']
    })
  })

  it('returns null for bare slash followed by only whitespace', () => {
    expect(parseSlashInput('/   ')).toBeNull()
  })

  it('returns null for slash followed by newline', () => {
    // The trimmed string is "/\n", body = "\n".trim() = "", so null
    expect(parseSlashInput('/\n')).toBeNull()
  })

  it('handles leading whitespace before the slash', () => {
    expect(parseSlashInput('  /compact')).toEqual({
      name: 'compact',
      args: []
    })
  })

  it('lowercases unicode command names', () => {
    expect(parseSlashInput('/MODEL')).toEqual({
      name: 'model',
      args: []
    })
  })
})
