import type { Record as CrateRecord } from './types'
import { newId, type ImportRecord } from '../stores/storage'

/** Marks an id as one of yours rather than something dug out of a library. */
export const LOCAL_PREFIX = 'local:'

export function isLocal(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX)
}

/**
 * Where imported file bytes live.
 *
 * Its own cache, not the one downloads share: that one evicts oldest-first
 * to stay under a budget, which is right for things that can be fetched
 * again and very wrong for the only copy of a file you chose.
 */
const IMPORT_CACHE = 'crate-imports-v1'

/**
 * Cache Storage keys have to be URLs, and same-origin ones are the only kind
 * it will store a synthetic response against. Nothing ever requests this
 * path — reads go through `cache.match` directly.
 */
function bytesKey(id: string): string {
  return `${location.origin}/__crate-import/${encodeURIComponent(id)}`
}

function cacheStorage(): CacheStorage | null {
  return typeof caches !== 'undefined' ? caches : null
}

export async function putBytes(id: string, blob: Blob): Promise<boolean> {
  const cs = cacheStorage()
  if (!cs) return false
  try {
    const cache = await cs.open(IMPORT_CACHE)
    await cache.put(bytesKey(id), new Response(blob))
    return true
  } catch {
    // Quota, private mode, or a browser that won't store the response.
    return false
  }
}

export async function getBytes(id: string): Promise<Blob | null> {
  const cs = cacheStorage()
  if (!cs) return null
  try {
    const cache = await cs.open(IMPORT_CACHE)
    const hit = await cache.match(bytesKey(id))
    return hit ? await hit.blob() : null
  } catch {
    return null
  }
}

export async function dropBytes(id: string): Promise<void> {
  const cs = cacheStorage()
  if (!cs) return
  try {
    const cache = await cs.open(IMPORT_CACHE)
    await cache.delete(bytesKey(id))
  } catch {
    // Nothing to do about it; the entry is going either way.
  }
}

/**
 * Object URLs for imported files, one per import per session.
 *
 * A file has no address, so playback needs a blob URL — and those die with
 * the document, which is why they're minted here on the way out rather than
 * stored. Held so returning to a track doesn't leak a second one.
 */
const objectUrls = new Map<string, string>()

export function forgetObjectUrl(id: string) {
  const url = objectUrls.get(id)
  if (!url) return
  URL.revokeObjectURL(url)
  objectUrls.delete(id)
}

async function streamUrlFor(imp: ImportRecord): Promise<string> {
  if (imp.kind === 'link') return imp.url
  const held = objectUrls.get(imp.id)
  if (held) return held
  const blob = await getBytes(imp.id)
  if (!blob) return ''
  const url = URL.createObjectURL(blob)
  objectUrls.set(imp.id, url)
  return url
}

/** What an import looks like to the rest of the app. */
export async function toRecord(imp: ImportRecord): Promise<CrateRecord> {
  return {
    id: imp.id,
    title: imp.title,
    creator: imp.creator,
    collection: 'yours',
    year: null,
    artworkUrl: null,
    tracks: [
      {
        name: imp.trackName,
        title: imp.title,
        durationSec: imp.durationSec,
        streamUrl: await streamUrlFor(imp),
      },
    ],
    sourceUrl: imp.url,
    source: imp.kind === 'link' ? 'your link' : 'your file',
  }
}

/**
 * The same shape without the bytes, for listings.
 *
 * Rows only need a title and a destination, and minting an object URL for
 * every import just to draw a list would hold the whole crate in memory.
 */
export function toStubRecord(imp: ImportRecord): CrateRecord {
  return {
    id: imp.id,
    title: imp.title,
    creator: imp.creator,
    collection: 'yours',
    year: null,
    artworkUrl: null,
    tracks: [],
    sourceUrl: imp.url,
    source: imp.kind === 'link' ? 'your link' : 'your file',
  }
}

/* ---- bringing things in ---- */

/** How long to wait on metadata before calling a source dead. */
const PROBE_TIMEOUT_MS = 15000

interface Probe {
  /** Whether the browser could open it at all. */
  playable: boolean
  /** Null when it opened but wouldn't say how long it is. */
  durationSec: number | null
}

/**
 * Asks the browser to open it, which answers both questions at once.
 *
 * Playability and length are kept apart on purpose. A host that answers a
 * range request with a plain 200 — plenty do — leaves the tag unable to
 * work out a duration and reporting Infinity, and treating that as a
 * failure would turn a perfectly good link away. Length is a nicety; being
 * able to play it is the thing that matters.
 *
 * This also beats trusting a file extension or a Content-Type header: what
 * the tag can open is exactly what the app can use.
 */
function probeAudio(src: string): Promise<Probe> {
  return new Promise(resolve => {
    const el = document.createElement('audio')
    let settled = false
    const done = (value: Probe) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      el.removeAttribute('src')
      el.load()
      resolve(value)
    }
    const timer = setTimeout(() => done({ playable: false, durationSec: null }), PROBE_TIMEOUT_MS)

    el.preload = 'metadata'
    el.addEventListener('loadedmetadata', () =>
      done({
        playable: true,
        durationSec: Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null,
      }),
    )
    el.addEventListener('error', () => done({ playable: false, durationSec: null }))
    el.src = src
  })
}

/**
 * Whether the bytes can be read, not just played.
 *
 * Asks for the first two of them: enough to find out whether the host sends
 * the header that lets this app read the response, without pulling a file
 * down twice. A host that ignores the range and sends everything still
 * answers the question, so the body is discarded rather than waited on.
 */
async function probeReadable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' } })
    void res.body?.cancel()
    return res.ok || res.status === 206
  } catch {
    return false
  }
}

function tidyTitle(raw: string): string {
  const stem = raw.replace(/\.[^./\\]+$/, '')
  const spaced = stem.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim()
  return spaced || raw || 'Untitled'
}

/** The filename at the end of a URL, or something usable if there isn't one. */
function nameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname
    const last = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
    if (last) return last
  } catch {
    // Falls through to the generic name.
  }
  return 'audio'
}

export interface IngestResult {
  record: ImportRecord
  /** Said out loud when it matters, e.g. playable but not choppable. */
  note: string | null
}

export class ImportError extends Error {}

export async function ingestLink(rawUrl: string): Promise<IngestResult> {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new ImportError('Paste a link first.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ImportError("That doesn't look like a link.")
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ImportError('Links need to start with http or https.')
  }
  // A page served over https can't pull audio over http; the browser blocks
  // it as mixed content and the failure would look like a dead link.
  if (url.protocol === 'http:' && location.protocol === 'https:') {
    throw new ImportError('That link is http, which this page cannot load. Try https.')
  }

  const probe = await probeAudio(url.href)
  if (!probe.playable) {
    throw new ImportError(
      "Couldn't play that. It needs to point straight at an audio file, not a page about one.",
    )
  }

  const readable = await probeReadable(url.href)
  const name = nameFromUrl(url.href)

  return {
    record: {
      id: `${LOCAL_PREFIX}${newId()}`,
      title: tidyTitle(name),
      creator: url.hostname.replace(/^www\./, ''),
      trackName: name,
      durationSec: probe.durationSec,
      kind: 'link',
      url: url.href,
      readable,
      bytes: null,
      addedAt: Date.now(),
    },
    note: readable
      ? null
      : "Added. It'll play and take flags, but the host won't let this app read the file, so it can't be chopped.",
  }
}

export async function ingestFile(file: File): Promise<IngestResult> {
  const id = `${LOCAL_PREFIX}${newId()}`
  const objectUrl = URL.createObjectURL(file)

  let probe: Probe
  try {
    probe = await probeAudio(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }

  if (!probe.playable) {
    throw new ImportError("Couldn't play that file. Try an mp3, m4a, wav or ogg.")
  }

  const stored = await putBytes(id, file)
  if (!stored) {
    throw new ImportError("Couldn't keep a copy of that file — storage is full or unavailable.")
  }

  return {
    record: {
      id,
      title: tidyTitle(file.name),
      creator: 'From your device',
      trackName: file.name,
      durationSec: probe.durationSec,
      kind: 'file',
      url: '',
      readable: true,
      bytes: file.size,
      addedAt: Date.now(),
    },
    note: null,
  }
}
