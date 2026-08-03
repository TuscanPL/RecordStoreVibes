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
  /** Empty until `getRecord` hydrates it — listings don't fetch file lists. */
  tracks: Track[]
  /** archive.org details page — goes into the export manifest. */
  sourceUrl: string
  /**
   * Which library it came from. Travels with the record so provenance is
   * visible wherever it turns up, and stays right once there's more than
   * one place to dig.
   */
  source?: string
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
  /** Last page actually read, so the session knows where to resume. */
  lastPage: number
  /** True once there's nothing left upstream to page into. */
  drained: boolean
}

export interface DigOptions {
  limit: number
  /** 1-based. Paging deeper into a downloads-desc sort is the deep-cut dial. */
  page?: number
  /** Identifiers already seen this session; filtered out server-side results. */
  exclude?: ReadonlySet<string>
}

export interface MusicProvider {
  name: string
  search(query: string, opts: DigOptions): Promise<CrateListing>
  browseQuery(query: string, opts: DigOptions): Promise<CrateListing>
  getRecord(id: string): Promise<Record | null>
}

export interface Crate {
  id: string
  label: string
  blurb: string
  /** Raw IA query. Playability and mediatype filters are added downstream. */
  query: string
}

/**
 * Entry points into the archive. Deliberately a fixed menu, not a feed.
 *
 * Mixed on purpose: `collection:` gives tight curation but depends on an
 * exact identifier existing, while `subject:` is loose but nearly always
 * returns something. If one crate ever comes up empty, the others still work.
 */
export const CRATES: Crate[] = [
  { id: '78s', label: '78 RPM', blurb: 'Great 78 Project', query: 'collection:(georgeblood)' },
  { id: 'jazz', label: 'Jazz', blurb: 'Early and trad', query: 'subject:(jazz)' },
  { id: 'blues', label: 'Blues', blurb: 'Country and delta', query: 'subject:(blues)' },
  { id: 'gospel', label: 'Gospel', blurb: 'Spirituals and hymns', query: 'subject:(gospel OR spiritual)' },
  { id: 'soul', label: 'Soul / Funk', blurb: 'Breaks and grooves', query: 'subject:(soul OR funk OR "rhythm and blues")' },
  { id: 'live', label: 'Live Sets', blurb: 'Live Music Archive', query: 'collection:(etree)' },
  { id: 'netlabel', label: 'Netlabels', blurb: 'Creative Commons releases', query: 'collection:(netlabels)' },
  { id: 'library', label: 'Library', blurb: 'Production and mood music', query: 'subject:("library music" OR "production music")' },
  { id: 'field', label: 'Field Recs', blurb: 'Location recordings', query: 'subject:("field recording" OR "field recordings")' },
  { id: 'world', label: 'World', blurb: 'Traditional and folk', query: 'subject:("folk music" OR traditional OR ethnographic)' },
  { id: 'classical', label: 'Classical', blurb: 'Orchestral and chamber', query: 'subject:(classical OR orchestral OR symphony)' },
  { id: 'radio', label: 'Radio', blurb: 'Old time radio', query: 'collection:(oldtimeradio)' },
  { id: 'spoken', label: 'Spoken', blurb: 'Readings and poetry', query: 'subject:(poetry OR "spoken word")' },
]
