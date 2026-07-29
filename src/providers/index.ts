import type { MusicProvider } from './types'
import { InternetArchiveProvider } from './internet-archive'

/**
 * Single provider by design — the handoff rules out multi-source
 * aggregation for v1. This indirection exists only so the app code
 * never imports the IA client directly.
 */
export const provider: MusicProvider = new InternetArchiveProvider()

export * from './types'
