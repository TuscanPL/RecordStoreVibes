import type { MusicProvider, Record, Track, CrateListing } from './types'

const SEARCH_URL = 'https://archive.org/advancedsearch.php'
const METADATA_URL = 'https://archive.org/metadata'
const DOWNLOAD_URL = 'https://archive.org/download'
const THUMB_URL = 'https://archive.org/services/img'

const REQUEST_TIMEOUT = 12000

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
  }
}

async function runSearch(query: string, limit: number): Promise<CrateListing> {
  const params = new URLSearchParams({
    q: query,
    'fl[]': 'identifier',
    rows: String(limit),
    page: '1',
    output: 'json',
  })
  // advancedsearch only returns the fields asked for, and repeats the key.
  const url =
    `${SEARCH_URL}?${params}` +
    '&fl[]=title&fl[]=creator&fl[]=collection&fl[]=year&fl[]=date' +
    '&sort[]=downloads+desc'

  const data = await getJson(url)
  const docs: SearchDoc[] = data?.response?.docs ?? []
  const totalFound: number = data?.response?.numFound ?? docs.length

  return {
    label: '',
    records: docs.map(toRecord),
    totalFound,
  }
}

export class InternetArchiveProvider implements MusicProvider {
  name = 'Internet Archive'

  async search(query: string, limit: number): Promise<CrateListing> {
    const trimmed = query.trim()
    if (!trimmed) return { label: '', records: [], totalFound: 0 }

    // Quote-safe: IA's parser chokes on stray colons and quotes from a
    // free-text field, so the user's words go in as a single phrase-ish term.
    const safe = trimmed.replace(/["\\:]/g, ' ')
    const listing = await runSearch(`(${safe}) AND mediatype:(audio)`, limit)
    return { ...listing, label: `“${trimmed}”` }
  }

  async browseCollection(collectionId: string, limit: number): Promise<CrateListing> {
    const listing = await runSearch(
      `collection:(${collectionId}) AND mediatype:(audio)`,
      limit,
    )
    return { ...listing, label: collectionId }
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
    }
  }
}
