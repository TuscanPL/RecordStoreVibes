import type { MusicProvider } from './types'
import { InternetArchiveProvider } from './internet-archive'

/**
 * Single provider by design — the handoff rules out multi-source
 * aggregation for v1. This indirection exists only so the app code
 * never imports the IA client directly.
 */
export const provider: MusicProvider = new InternetArchiveProvider()

export * from './types'

/**
 * Where a record came from, in words.
 *
 * Falls back to the host of its page, so records cached before `source` was
 * stored still say something honest rather than nothing.
 */
export function sourceLabel(record: { source?: string; sourceUrl?: string }): string {
  if (record.source) return record.source
  try {
    return new URL(record.sourceUrl ?? '').hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}
