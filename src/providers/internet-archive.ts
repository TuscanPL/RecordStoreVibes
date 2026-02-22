import type { MusicProvider, Album, AlbumDetails, Track, AlbumSide } from './types'

const IA_SEARCH_URL = 'https://archive.org/advancedsearch.php'
const IA_METADATA_URL = 'https://archive.org/metadata'
const IA_DOWNLOAD_URL = 'https://archive.org/download'

const GENRE_QUERIES: Record<string, string> = {
  jazz: 'subject:(jazz) AND mediatype:(audio)',
  classical: 'subject:(classical OR orchestral OR symphony) AND mediatype:(audio)',
  blues: 'subject:(blues) AND mediatype:(audio)',
  folk: 'subject:(folk OR traditional) AND mediatype:(audio)',
  world: 'subject:(world music OR ethnic OR traditional) AND mediatype:(audio)',
  gospel: 'subject:(gospel OR spiritual OR hymn) AND mediatype:(audio)',
  spoken: 'subject:(spoken word OR poetry OR speech) AND mediatype:(audio)',
  surprise: 'mediatype:(audio)',
}

const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.flac', '.wav', '.m4a']

const METADATA_CONCURRENCY = 5
const METADATA_TIMEOUT = 10000

interface IASearchDoc {
  identifier: string
  title?: string
  creator?: string
  date?: string
  year?: string
  subject?: string | string[]
  description?: string
}

interface IAFile {
  name: string
  format?: string
  title?: string
  track?: string
  length?: string
  size?: string
  source?: string
}

function isAudioFile(file: IAFile): boolean {
  const name = file.name.toLowerCase()
  return AUDIO_EXTENSIONS.some(ext => name.endsWith(ext)) &&
    file.source !== 'metadata'
}

function preferredAudioFiles(files: IAFile[]): IAFile[] {
  const audioFiles = files.filter(isAudioFile)

  const mp3Files = audioFiles.filter(f => f.name.toLowerCase().endsWith('.mp3'))
  if (mp3Files.length > 0) return mp3Files

  const oggFiles = audioFiles.filter(f => f.name.toLowerCase().endsWith('.ogg'))
  if (oggFiles.length > 0) return oggFiles

  return audioFiles
}

function splitIntoSides(tracks: Track[]): { A: AlbumSide; B: AlbumSide } {
  if (tracks.length === 0) {
    return { A: { tracks: [] }, B: { tracks: [] } }
  }

  if (tracks.length === 1) {
    return {
      A: { tracks },
      B: { tracks: [] },
    }
  }

  const mid = Math.ceil(tracks.length / 2)
  return {
    A: { tracks: tracks.slice(0, mid) },
    B: { tracks: tracks.slice(mid) },
  }
}

function getCoverArtUrl(identifier: string, files: IAFile[]): string | null {
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif']
  const coverPatterns = ['cover', 'front', 'folder', 'album', 'artwork']

  const imageFiles = files.filter(f => {
    const name = f.name.toLowerCase()
    return imageExts.some(ext => name.endsWith(ext))
  })

  const coverFile = imageFiles.find(f => {
    const name = f.name.toLowerCase()
    return coverPatterns.some(p => name.includes(p))
  })

  if (coverFile) {
    return `${IA_DOWNLOAD_URL}/${identifier}/${encodeURIComponent(coverFile.name)}`
  }

  if (imageFiles.length > 0 && imageFiles[0]) {
    return `${IA_DOWNLOAD_URL}/${identifier}/${encodeURIComponent(imageFiles[0].name)}`
  }

  return `https://archive.org/services/img/${identifier}`
}

async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return response
  } finally {
    clearTimeout(id)
  }
}

async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const i = index++
      const item = items[i]
      if (!item) continue
      try {
        const result = await fn(item)
        if (result) results.push(result)
      } catch {
        // skip failed items
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export class InternetArchiveProvider implements MusicProvider {
  name = 'Internet Archive'

  async search(genre: string, count: number, excludeIds: string[]): Promise<Album[]> {
    const query = GENRE_QUERIES[genre] ?? GENRE_QUERIES['surprise'] ?? 'mediatype:(audio)'
    const fetchCount = count + excludeIds.length + 10

    // First do a lightweight query to find total results, then pick a valid random page
    const countParams = new URLSearchParams({
      q: query,
      fl: 'identifier',
      rows: '0',
      output: 'json',
    })

    let numFound = 1000 // fallback assumption
    try {
      const countResp = await fetchWithTimeout(`${IA_SEARCH_URL}?${countParams}`, METADATA_TIMEOUT)
      if (countResp.ok) {
        const countData = await countResp.json()
        numFound = countData.response?.numFound ?? 1000
      }
    } catch {
      // use fallback
    }

    const maxPage = Math.max(1, Math.floor(numFound / fetchCount))
    const randomPage = Math.floor(Math.random() * Math.min(maxPage, 50)) + 1

    const params = new URLSearchParams({
      q: query,
      fl: 'identifier,title,creator,date,year,subject',
      sort: 'downloads desc',
      rows: String(fetchCount),
      page: String(randomPage),
      output: 'json',
    })

    const response = await fetchWithTimeout(`${IA_SEARCH_URL}?${params}`, METADATA_TIMEOUT)
    if (!response.ok) {
      throw new Error(`IA search failed: ${response.status}`)
    }

    const data = await response.json()
    const docs: IASearchDoc[] = data.response?.docs || []

    const filtered = docs.filter(doc => !excludeIds.includes(doc.identifier))
    const candidates = filtered.slice(0, count)

    // Fetch metadata concurrently instead of sequentially
    const albums = await runConcurrent(candidates, METADATA_CONCURRENCY, (doc) =>
      this.buildAlbumFromDoc(doc, genre)
    )

    return albums
  }

  private async buildAlbumFromDoc(doc: IASearchDoc, genre: string): Promise<Album | null> {
    const metaResponse = await fetchWithTimeout(`${IA_METADATA_URL}/${doc.identifier}`, METADATA_TIMEOUT)
    if (!metaResponse.ok) return null

    const meta = await metaResponse.json()
    const files: IAFile[] = meta.files || []

    const audioFiles = preferredAudioFiles(files)
    if (audioFiles.length === 0) return null

    const tracks: Track[] = audioFiles.map((f) => ({
      id: `${doc.identifier}/${f.name}`,
      title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      duration: f.length ? parseFloat(f.length) : null,
      streamUrl: `${IA_DOWNLOAD_URL}/${doc.identifier}/${encodeURIComponent(f.name)}`,
    }))

    const sides = splitIntoSides(tracks)

    return {
      id: doc.identifier,
      title: doc.title || 'Unknown Album',
      artist: doc.creator || 'Unknown Artist',
      year: doc.year || doc.date?.substring(0, 4) || null,
      genre,
      coverArtUrl: getCoverArtUrl(doc.identifier, files),
      sides,
      sourceUrl: `https://archive.org/details/${doc.identifier}`,
      provider: this.name,
    }
  }

  async getAlbumDetails(id: string): Promise<AlbumDetails> {
    const response = await fetchWithTimeout(`${IA_METADATA_URL}/${id}`, METADATA_TIMEOUT)
    if (!response.ok) throw new Error(`Failed to fetch album details: ${response.status}`)

    const meta = await response.json()
    const metadata = meta.metadata || {}
    const files: IAFile[] = meta.files || []

    const audioFiles = preferredAudioFiles(files)
    const tracks: Track[] = audioFiles.map((f) => ({
      id: `${id}/${f.name}`,
      title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      duration: f.length ? parseFloat(f.length) : null,
      streamUrl: `${IA_DOWNLOAD_URL}/${id}/${encodeURIComponent(f.name)}`,
    }))

    const sides = splitIntoSides(tracks)

    return {
      id,
      title: metadata.title || 'Unknown Album',
      artist: metadata.creator || 'Unknown Artist',
      year: metadata.year || metadata.date?.substring(0, 4) || null,
      genre: Array.isArray(metadata.subject) ? metadata.subject[0] : (metadata.subject || 'Unknown'),
      coverArtUrl: getCoverArtUrl(id, files),
      sides,
      sourceUrl: `https://archive.org/details/${id}`,
      provider: this.name,
      description: metadata.description || null,
    }
  }

  async getStreamUrl(trackId: string): Promise<string> {
    return `${IA_DOWNLOAD_URL}/${trackId}`
  }

  async getAlbumArt(id: string): Promise<string | null> {
    return `https://archive.org/services/img/${id}`
  }
}
