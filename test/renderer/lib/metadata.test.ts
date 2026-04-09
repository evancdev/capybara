import { describe, it, expect } from 'vitest'
import { mergeMetadata } from '@/renderer/lib/metadata'
import type { SessionMetadata } from '@/shared/types/session'

describe('mergeMetadata', () => {
  it('returns undefined when both inputs are undefined', () => {
    expect(mergeMetadata(undefined, undefined)).toBeUndefined()
  })

  it('returns descriptorMeta when liveMeta is undefined', () => {
    const desc: SessionMetadata = { model: 'claude-opus-4' }
    const result = mergeMetadata(desc, undefined)
    expect(result).toBe(desc)
  })

  it('returns liveMeta when descriptorMeta is undefined', () => {
    const live: SessionMetadata = { model: 'claude-sonnet-4' }
    const result = mergeMetadata(undefined, live)
    expect(result).toBe(live)
  })

  it('merges both with liveMeta taking precedence', () => {
    const desc: SessionMetadata = {
      model: 'claude-opus-4',
      contextWindow: '200k'
    }
    const live: SessionMetadata = { model: 'claude-sonnet-4' }
    const result = mergeMetadata(desc, live)
    expect(result).toEqual({
      model: 'claude-sonnet-4',
      contextWindow: '200k'
    })
  })

  it('returns same reference when only descriptorMeta is defined (stable identity)', () => {
    const desc: SessionMetadata = { plan: 'pro' }
    expect(mergeMetadata(desc, undefined)).toBe(desc)
  })

  it('returns same reference when only liveMeta is defined (stable identity)', () => {
    const live: SessionMetadata = { plan: 'pro' }
    expect(mergeMetadata(undefined, live)).toBe(live)
  })

  it('returns a new object when both are defined (not same reference)', () => {
    const desc: SessionMetadata = { model: 'a' }
    const live: SessionMetadata = { model: 'b' }
    const result = mergeMetadata(desc, live)
    expect(result).not.toBe(desc)
    expect(result).not.toBe(live)
  })
})
