/** A single playable audio file within an IA item. */
export interface Track {
  /** Filename within the IA item — stable, used as the marker's track key. */
  name: string
  title: string
  durationSec: number | null
  streamUrl: string
}

/** An Internet Archive item. One item = one "record" in the crate. */
export interface Record {
  /** IA identifier. */
  id: string
  title: string
  creator: string
  collection: string
  year: string | null
  artworkUrl: string | null
  tracks: Track[]
  /** archive.org details page — goes into the export manifest. */
  sourceUrl: string
}

/** A flagged timestamp. The core artifact this app produces. */
export interface Marker {
  id: string
  recordId: string
  /** Filename of the track within the item. */
  trackName: string
  timestampSec: number
  note?: string
  createdAt: number
}

/** A finite, named list of records. No pagination, no infinite scroll. */
export interface CrateListing {
  label: string
  records: Record[]
  /** Total matches upstream, so the UI can be honest about what it capped. */
  totalFound: number
}

export interface MusicProvider {
  name: string
  search(query: string, limit: number): Promise<CrateListing>
  browseCollection(collectionId: string, limit: number): Promise<CrateListing>
  getRecord(id: string): Promise<Record | null>
}

/** Curated entry points. Deliberately few — this is a menu, not a feed. */
export const COLLECTIONS = [
  {
    id: 'georgeblood',
    label: '78 RPM',
    blurb: 'Great 78 Project — shellac digitisations',
  },
  {
    id: 'audio_music',
    label: 'Music',
    blurb: 'General music uploads',
  },
  {
    id: 'etree',
    label: 'Live Sets',
    blurb: 'Live Music Archive — soundboard recordings',
  },
  {
    id: 'audio_religion',
    label: 'Gospel',
    blurb: 'Spirituals, hymns, sermons',
  },
  {
    id: 'audio_bookspoetry',
    label: 'Spoken',
    blurb: 'Poetry, readings, speech',
  },
  {
    id: 'oldtimeradio',
    label: 'Radio',
    blurb: 'Old time radio broadcasts',
  },
] as const
