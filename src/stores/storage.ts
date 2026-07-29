import type { Record, Marker } from '../providers/types'

/** A trimmed region of one track, assigned to a pad. */
export interface Pad {
  startSec: number
  endSec: number
  /** Semitones. Varispeed, so this shifts length too — like a sampler's pitch. */
  pitch: number
}

/** The working range for a track, kept so you resume where you stopped. */
export interface TrimState {
  startSec: number
  endSec: number
  /** Whether the strip was zoomed to it. */
  zoomed: boolean
}

export const PAD_COUNT = 16
/** Banks of pads per track, switched by swiping the grid. */
export const PAD_SETS = 4

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
  pads: { [trackKey: string]: (Pad | null)[][] }
  /** Working ranges per track. Two numbers each — cheap to keep. */
  trims: { [trackKey: string]: TrimState }
}

const EMPTY: Persisted = {
  version: 1,
  records: {},
  markers: [],
  starred: {},
  unplayable: [],
  pads: {},
  trims: {},
}

/**
 * Pads used to be one flat bank per track. A stored entry whose first
 * element isn't itself an array is from before sets existed, so it becomes
 * set one and the rest start empty.
 */
function migratePads(raw: unknown): { [k: string]: (Pad | null)[][] } {
  const out: { [k: string]: (Pad | null)[][] } = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as { [k: string]: unknown })) {
    if (!Array.isArray(v)) continue
    out[k] = Array.isArray(v[0]) ? (v as (Pad | null)[][]) : [v as (Pad | null)[]]
  }
  return out
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
      pads: migratePads(parsed.pads),
      trims: parsed.trims ?? {},
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
