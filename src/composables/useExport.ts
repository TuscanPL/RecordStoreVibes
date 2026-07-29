import type { FlaggedGroup } from '../stores/library'
import { formatTime } from './useAudio'

function download(filename: string, mime: string, body: string) {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari needs the URL to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function trackUrl(recordId: string, trackName: string): string {
  return `https://archive.org/download/${recordId}/${encodeURIComponent(trackName)}`
}

export function buildJson(groups: FlaggedGroup[]): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: 'Internet Archive',
      records: groups.map(({ record, markers }) => {
        const byTrack = new Map<string, typeof markers>()
        for (const m of markers) {
          const list = byTrack.get(m.trackName)
          if (list) list.push(m)
          else byTrack.set(m.trackName, [m])
        }

        return {
          identifier: record.id,
          title: record.title,
          creator: record.creator,
          year: record.year,
          sourceUrl: record.sourceUrl,
          tracks: [...byTrack.entries()].map(([trackName, list]) => ({
            file: trackName,
            downloadUrl: trackUrl(record.id, trackName),
            markers: list.map(m => ({
              timestampSec: Number(m.timestampSec.toFixed(2)),
              timestamp: formatTime(m.timestampSec),
              note: m.note ?? null,
            })),
          })),
        }
      }),
    },
    null,
    2,
  )
}

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(groups: FlaggedGroup[]): string {
  const header = [
    'identifier',
    'title',
    'creator',
    'file',
    'downloadUrl',
    'timestampSec',
    'timestamp',
    'note',
    'sourceUrl',
  ]

  const rows = [header.join(',')]
  for (const { record, markers } of groups) {
    for (const m of markers) {
      rows.push(
        [
          record.id,
          record.title,
          record.creator,
          m.trackName,
          trackUrl(record.id, m.trackName),
          m.timestampSec.toFixed(2),
          formatTime(m.timestampSec),
          m.note ?? '',
          record.sourceUrl,
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }
  return rows.join('\n')
}

export function useExport() {
  return {
    exportJson(groups: FlaggedGroup[]) {
      download(`crate-${stamp()}.json`, 'application/json', buildJson(groups))
    },
    exportCsv(groups: FlaggedGroup[]) {
      download(`crate-${stamp()}.csv`, 'text/csv', buildCsv(groups))
    },
    trackUrl,
  }
}
