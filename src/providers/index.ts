import type { MusicProvider, Record as CrateRecord } from './types'
import { InternetArchiveProvider } from './internet-archive'
import { isLocal, toRecord } from './local'
import { useLibrary } from '../stores/library'

const archive = new InternetArchiveProvider()

/**
 * One entry point over two very different sources.
 *
 * Searching and browsing stay the archive's job — your own imports are a
 * finite list, not something to page through. Only `getRecord` forks, and
 * it forks on the id, so every view can go on asking for a record by id
 * without knowing where that record came from.
 */
export const provider: MusicProvider = {
  name: 'crate',
  search: (query, opts) => archive.search(query, opts),
  browseQuery: (query, opts) => archive.browseQuery(query, opts),
  async getRecord(id: string): Promise<CrateRecord | null> {
    if (!isLocal(id)) return archive.getRecord(id)
    const imported = useLibrary().imports[id]
    return imported ? await toRecord(imported) : null
  },
}

export * from './types'
export { isLocal, LOCAL_PREFIX } from './local'

/**
 * Where a record came from, in words.
 *
 * Falls back to the host of its page, so records cached before `source` was
 * stored still say something honest rather than nothing.
 */
export function sourceLabel(record: { source?: string; sourceUrl?: string }): string {
  if (record.source) return record.source
  try {
    return new URL(record.sourceUrl ?? '').hostname.replace(/^www\./, '')
  } catch {
    return 'unknown source'
  }
}

/**
 * A link to the original audio, for exports.
 *
 * Null rather than a guess when there isn't one. A file off your device has
 * no address, and inventing an archive.org URL for it — which is what this
 * did back when the archive was the only source — would put a dead link in
 * every manifest.
 */
export function downloadUrl(
  record: { id: string; sourceUrl?: string },
  trackName: string,
): string | null {
  if (isLocal(record.id)) return record.sourceUrl || null
  return `https://archive.org/download/${record.id}/${encodeURIComponent(trackName)}`
}
