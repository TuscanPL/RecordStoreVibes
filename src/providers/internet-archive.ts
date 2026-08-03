import type { MusicProvider, Record, Track, CrateListing, DigOptions } from './types'

const SEARCH_URL = 'https://archive.org/advancedsearch.php'
const METADATA_URL = 'https://archive.org/metadata'
const DOWNLOAD_URL = 'https://archive.org/download'
const THUMB_URL = 'https://archive.org/services/img'

const REQUEST_TIMEOUT = 12000

/** Shown on flags and written into exports. */
const SOURCE = 'Internet Archive'

/**
 * Browser-playable audio only. IA items frequently also carry FLAC and
 * lossless WAV — those are the download-for-later formats, not stream ones.
 */
const PLAYABLE = ['.mp3', '.ogg', '.m4a']

interface SearchDoc {
  identifier: string
  title?: string
  creator?: string | string[]
  collection?: string | string[]
  date?: string
  year?: string
}

interface MetaFile {
  name: string
  format?: string
  title?: string
  track?: string
  length?: string
  source?: string
}

async function getJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`archive.org returned ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

function first(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

/** IA `length` is either seconds ("183.4") or "mm:ss". */
function parseLength(raw: string | undefined): number | null {
  if (!raw) return null
  if (raw.includes(':')) {
    const parts = raw.split(':').map(Number)
    if (parts.some(isNaN)) return null
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
}

function cleanTrackTitle(file: MetaFile): string {
  if (file.title) return file.title
  return file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
}

function toTracks(identifier: string, files: MetaFile[]): Track[] {
  const playable = files.filter(f => {
    const name = f.name.toLowerCase()
    return f.source !== 'metadata' && PLAYABLE.some(ext => name.endsWith(ext))
  })

  // One item often ships the same audio in several formats. Keep one entry
  // per logical track, preferring mp3 for the widest mobile support.
  const byStem = new Map<string, MetaFile>()
  for (const f of playable) {
    const stem = f.name.replace(/\.[^.]+$/, '').toLowerCase()
    const existing = byStem.get(stem)
    if (!existing) {
      byStem.set(stem, f)
      continue
    }
    const isMp3 = f.name.toLowerCase().endsWith('.mp3')
    const existingIsMp3 = existing.name.toLowerCase().endsWith('.mp3')
    if (isMp3 && !existingIsMp3) byStem.set(stem, f)
  }

  return [...byStem.values()].map(f => ({
    name: f.name,
    title: cleanTrackTitle(f),
    durationSec: parseLength(f.length),
    streamUrl: `${DOWNLOAD_URL}/${identifier}/${encodeURIComponent(f.name)}`,
  }))
}

function toRecord(doc: SearchDoc): Record {
  return {
    id: doc.identifier,
    title: doc.title ?? doc.identifier,
    creator: first(doc.creator, 'Unknown'),
    collection: first(doc.collection, ''),
    year: doc.year ?? doc.date?.slice(0, 4) ?? null,
    artworkUrl: `${THUMB_URL}/${doc.identifier}`,
    tracks: [],
    sourceUrl: `https://archive.org/details/${doc.identifier}`,
    source: SOURCE,
  }
}

/**
 * Every listing query carries this.
 *
 * `format:(MP3)` is the important half: it makes the search index do the
 * playability filtering, so an item with nothing but FLAC or WAV never
 * reaches the browse list. Without it we'd only find out after the user
 * tapped through and waited for a metadata fetch. IA derives an MP3 for
 * essentially every audio upload, so this costs very little coverage.
 */
const LISTING_FILTER = 'mediatype:(audio) AND format:(MP3)'

async function fetchPage(query: string, rows: number, page: number) {
  // advancedsearch takes repeated fl[] keys for the fields it should return.
  const params = new URLSearchParams()
  params.set('q', query)
  for (const field of ['identifier', 'title', 'creator', 'collection', 'year', 'date']) {
    params.append('fl[]', field)
  }
  // Stable ordering matters more than the ordering itself: it's what makes
  // "page N+1" mean genuinely new records rather than a reshuffle. Paging
  // down a downloads-desc list is what surfaces the deep cuts.
  params.append('sort[]', 'downloads desc')
  params.set('rows', String(rows))
  params.set('page', String(page))
  params.set('output', 'json')

  const data = await getJson(`${SEARCH_URL}?${params}`)
  return {
    docs: (data?.response?.docs ?? []) as SearchDoc[],
    numFound: (data?.response?.numFound ?? 0) as number,
  }
}

async function runSearch(
  query: string,
  { limit, page = 1, exclude }: DigOptions,
): Promise<CrateListing> {
  const records: Record[] = []
  const taken = new Set<string>()
  let totalFound = 0
  let current = page
  /** The page actually read last — `current` may run one ahead of it. */
  let lastRead = page
  let drained = false

  /*
   * Excluding what's already been seen can gut a page, so keep reading until
   * there's a full crate or the archive runs out. Bounded: a few extra reads
   * is fine, an unbounded loop against a rate-limited API is not.
   */
  for (let reads = 0; reads < 4 && records.length < limit; reads++) {
    lastRead = current
    const { docs, numFound } = await fetchPage(query, limit, current)
    totalFound = numFound

    for (const doc of docs) {
      if (exclude?.has(doc.identifier) || taken.has(doc.identifier)) continue
      taken.add(doc.identifier)
      records.push(toRecord(doc))
      if (records.length >= limit) break
    }

    if (docs.length === 0 || current * limit >= numFound) {
      drained = true
      break
    }
    current++
  }

  return { label: '', records, totalFound, lastPage: lastRead, drained }
}

export class InternetArchiveProvider implements MusicProvider {
  name = 'Internet Archive'

  async search(query: string, opts: DigOptions): Promise<CrateListing> {
    const trimmed = query.trim()
    if (!trimmed) {
      return { label: '', records: [], totalFound: 0, lastPage: 1, drained: true }
    }

    // Quote-safe: IA's parser chokes on stray colons and quotes from a
    // free-text field, so the user's words go in as a single phrase-ish term.
    const safe = trimmed.replace(/["\\:]/g, ' ')
    const listing = await runSearch(`(${safe}) AND ${LISTING_FILTER}`, opts)
    return { ...listing, label: `“${trimmed}”` }
  }

  async browseQuery(query: string, opts: DigOptions): Promise<CrateListing> {
    const listing = await runSearch(`(${query}) AND ${LISTING_FILTER}`, opts)
    return { ...listing, label: query }
  }

  /** Hydrates the track list. Only called when a record is actually opened. */
  async getRecord(id: string): Promise<Record | null> {
    const meta = await getJson(`${METADATA_URL}/${id}`)
    if (!meta || !meta.metadata) return null

    const m = meta.metadata
    const tracks = toTracks(id, meta.files ?? [])
    if (tracks.length === 0) return null

    return {
      id,
      title: m.title ?? id,
      creator: first(m.creator, 'Unknown'),
      collection: first(m.collection, ''),
      year: m.year ?? m.date?.slice(0, 4) ?? null,
      artworkUrl: `${THUMB_URL}/${id}`,
      tracks,
      sourceUrl: `https://archive.org/details/${id}`,
      source: SOURCE,
    }
  }
}
