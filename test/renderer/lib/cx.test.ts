import { describe, it, expect } from 'vitest'
import { cx } from '@/renderer/lib/cx'

describe('cx', () => {
  it('returns a single class name', () => {
    expect(cx('foo')).toBe('foo')
  })

  it('joins multiple class names with spaces', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('filters out false', () => {
    expect(cx('a', false, 'b')).toBe('a b')
  })

  it('filters out null', () => {
    expect(cx('a', null, 'b')).toBe('a b')
  })

  it('filters out undefined', () => {
    expect(cx('a', undefined, 'b')).toBe('a b')
  })

  it('filters out empty strings (falsy)', () => {
    expect(cx('a', '', 'b')).toBe('a b')
  })

  it('returns empty string for no args', () => {
    expect(cx()).toBe('')
  })

  it('returns empty string when all args are falsy', () => {
    expect(cx(false, null, undefined, '')).toBe('')
  })

  it('handles a single truthy value among many falsy', () => {
    expect(cx(false, null, 'only', undefined, '')).toBe('only')
  })
})
