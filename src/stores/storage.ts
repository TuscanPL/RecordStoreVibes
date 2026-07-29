import type { Record, Marker } from '../providers/types'

/** A trimmed region of one track, assigned to a pad. */
export interface Pad {
  startSec: number
  endSec: number
  /** Semitones. Varispeed, so this shifts length too — like a sampler's pitch. */
  pitch: number
}

export const PAD_COUNT = 16

/** Pads belong to a track: one decoded buffer in memory, never sixteen. */
export function padKey(recordId: string, trackName: string): string {
  return `${recordId}::${trackName}`
}

const KEY = 'crate.library.v1'

export interface Persisted {
  version: 1
  /** Metadata cache for records we've flagged or starred. */
  records: { [id: string]: Record }
  markers: Marker[]
  /** id -> starredAt epoch ms. */
  starred: { [id: string]: number }
  /**
   * Items that turned out to have no playable audio. Remembered so a dud
   * never appears in a listing twice.
   */
  unplayable: string[]
  /**
   * Pad layouts per track. Only numbers, so this is cheap to keep — the
   * audio itself is re-downloaded when you open the sampler again.
   */
  pads: { [trackKey: string]: (Pad | null)[] }
}

const EMPTY: Persisted = {
  version: 1,
  records: {},
  markers: [],
  starred: {},
  unplayable: [],
  pads: {},
}

export function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY }
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return { ...EMPTY }
    return {
      version: 1,
      records: parsed.records ?? {},
      markers: Array.isArray(parsed.markers) ? parsed.markers : [],
      starred: parsed.starred ?? {},
      unplayable: Array.isArray(parsed.unplayable) ? parsed.unplayable : [],
      pads: parsed.pads ?? {},
    }
  } catch {
    // Corrupt or unavailable storage shouldn't take the app down.
    return { ...EMPTY }
  }
}

export function save(state: Persisted): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
