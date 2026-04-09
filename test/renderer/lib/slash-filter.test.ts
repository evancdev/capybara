import { describe, it, expect } from 'vitest'
import { filterSlashCommands } from '@/renderer/lib/slash-filter'
import { SLASH_COMMANDS } from '@/shared/types/commands'

describe('filterSlashCommands', () => {
  it('returns all commands when filter is empty', () => {
    expect(filterSlashCommands('')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('returns empty array when filter matches no command', () => {
    expect(filterSlashCommands('xyz')).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    const lower = filterSlashCommands('c')
    const upper = filterSlashCommands('C')
    expect(lower).toEqual(upper)
  })

  it('is a pure prefix match (not substring)', () => {
    // "act" should NOT match "compact" because "compact" does not start with "act"
    const result = filterSlashCommands('act')
    const names = result.map((c) => c.name)
    expect(names).not.toContain('compact')
  })

  it('handles special regex characters without crashing', () => {
    // "[" is a special regex char. If the filter were used in a regex
    // without escaping, this would throw. Our implementation uses
    // String.startsWith, so it should be safe.
    expect(() => filterSlashCommands('[')).not.toThrow()
    expect(filterSlashCommands('[')).toHaveLength(0)
  })

  it('handles regex metacharacters: dot', () => {
    expect(() => filterSlashCommands('.')).not.toThrow()
    expect(filterSlashCommands('.')).toHaveLength(0)
  })

  it('handles regex metacharacters: backslash', () => {
    expect(() => filterSlashCommands('\\')).not.toThrow()
    expect(filterSlashCommands('\\')).toHaveLength(0)
  })

  it('handles regex metacharacters: parentheses', () => {
    expect(() => filterSlashCommands('(')).not.toThrow()
    expect(() => filterSlashCommands(')')).not.toThrow()
  })

  it('handles regex metacharacters: star and plus', () => {
    expect(() => filterSlashCommands('*')).not.toThrow()
    expect(() => filterSlashCommands('+')).not.toThrow()
  })

  it('returns the full spec objects, not just names', () => {
    const result = filterSlashCommands('c')
    for (const item of result) {
      expect(item).toHaveProperty('name')
      expect(item).toHaveProperty('description')
      expect(item).toHaveProperty('scope')
    }
  })

  it('filters correctly for each of the four kept commands', () => {
    expect(filterSlashCommands('compact')).toHaveLength(1)
    expect(filterSlashCommands('model')).toHaveLength(1)
    expect(filterSlashCommands('init')).toHaveLength(1)
    expect(filterSlashCommands('review')).toHaveLength(1)
  })

  it('with filter "i" matches "init" only (not model/compact/review)', () => {
    const result = filterSlashCommands('i')
    const names = result.map((c) => c.name)
    expect(names).toContain('init')
    expect(names).not.toContain('model')
    expect(names).not.toContain('compact')
    expect(names).not.toContain('review')
  })

  it('with filter "r" matches "review" only', () => {
    const result = filterSlashCommands('r')
    const names = result.map((c) => c.name)
    expect(names).toContain('review')
    expect(names).not.toContain('compact')
  })
})
