import type { Record, Marker } from '../providers/types'

const KEY = 'crate.library.v1'

export interface Persisted {
  version: 1
  /** Metadata cache for records we've flagged or starred. */
  records: { [id: string]: Record }
  markers: Marker[]
  /** id -> starredAt epoch ms. */
  starred: { [id: string]: number }
}

const EMPTY: Persisted = { version: 1, records: {}, markers: [], starred: {} }

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
