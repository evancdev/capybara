import type { SessionMetadata } from '@/shared/types/session'

/**
 * Merge metadata from the session descriptor (available at creation) with
 * live metadata from `metadata_updated` messages. The live stream values
 * take precedence over the descriptor values when both are defined.
 *
 * Returns the original reference when only one side is defined, so React
 * memoization downstream (MessagePanel) sees a stable identity as long as
 * the underlying inputs haven't changed.
 */
export function mergeMetadata(
  descriptorMeta: SessionMetadata | undefined,
  liveMeta: SessionMetadata | undefined
): SessionMetadata | undefined {
  if (!descriptorMeta && !liveMeta) return undefined
  if (!liveMeta) return descriptorMeta
  if (!descriptorMeta) return liveMeta
  return { ...descriptorMeta, ...liveMeta }
}
