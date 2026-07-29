import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Record as CrateRecord, Marker } from '../providers/types'
import {
  load,
  save,
  newId,
  padKey,
  PAD_COUNT,
  PAD_BANKS,
  type Persisted,
  type Pad,
  type TrimState,
} from './storage'

export interface ChoppedTrack {
  key: string
  recordId: string
  trackName: string
  count: number
  record: CrateRecord
}

export interface FlaggedGroup {
  record: CrateRecord
  markers: Marker[]
}

export const useLibrary = defineStore('library', () => {
  const initial = load()

  const records = ref<{ [id: string]: CrateRecord }>(initial.records)
  const markers = ref<Marker[]>(initial.markers)
  const starred = ref<{ [id: string]: number }>(initial.starred)
  const unplayable = ref<string[]>(initial.unplayable)
  const pads = ref<{ [trackKey: string]: (Pad | null)[][] }>(initial.pads)
  const trims = ref<{ [trackKey: string]: TrimState }>(initial.trims)
  /** Set when the browser refuses to persist (private mode, quota). */
  const persistFailed = ref(false)

  function snapshot(): Persisted {
    return {
      version: 1,
      records: records.value,
      markers: markers.value,
      starred: starred.value,
      unplayable: unplayable.value,
      pads: pads.value,
      trims: trims.value,
    }
  }

  watch(
    [records, markers, starred, unplayable, pads, trims],
    () => {
      persistFailed.value = !save(snapshot())
    },
    { deep: true },
  )

  function padsFor(key: string, bank = 0): (Pad | null)[] {
    return pads.value[key]?.[bank] ?? new Array(PAD_COUNT).fill(null)
  }

  function writeBanks(key: string, banks: (Pad | null)[][]) {
    // Drop the whole track once every bank is empty, so gc can reclaim it.
    if (banks.every(b => b.every(p => p === null))) delete pads.value[key]
    else pads.value[key] = banks
  }

  function setPad(key: string, bank: number, index: number, pad: Pad | null) {
    const banks: (Pad | null)[][] = (pads.value[key] ?? []).map(b => [...b])
    while (banks.length <= bank) banks.push(new Array(PAD_COUNT).fill(null))
    banks[bank]![index] = pad
    writeBanks(key, banks)
  }

  /** Empties one bank, leaving the others alone. */
  function clearBank(key: string, bank: number) {
    const banks: (Pad | null)[][] = (pads.value[key] ?? []).map(b => [...b])
    if (!banks[bank]) return
    banks[bank] = new Array(PAD_COUNT).fill(null)
    writeBanks(key, banks)
  }

  /** How many pads each bank of a track holds, for the switcher. */
  function bankCounts(key: string): number[] {
    const banks = pads.value[key] ?? []
    return Array.from(
      { length: PAD_BANKS },
      (_, i) => banks[i]?.filter(Boolean).length ?? 0,
    )
  }

  function trimFor(key: string): TrimState | null {
    return trims.value[key] ?? null
  }

  function setTrim(key: string, trim: TrimState | null) {
    if (trim) trims.value[key] = trim
    else delete trims.value[key]
  }

  /** Remembered so a dud item never surfaces in a listing again. */
  function markUnplayable(id: string) {
    if (!unplayable.value.includes(id)) unplayable.value.push(id)
  }

  function isUnplayable(id: string): boolean {
    return unplayable.value.includes(id)
  }

  /** Keeps metadata around so the Flagged list works without a network call. */
  function remember(record: CrateRecord) {
    records.value[record.id] = record
  }

  function dropMarker(record: CrateRecord, trackName: string, timestampSec: number): Marker {
    remember(record)
    const marker: Marker = {
      id: newId(),
      recordId: record.id,
      trackName,
      timestampSec: Math.max(0, timestampSec),
      createdAt: Date.now(),
    }
    markers.value.push(marker)
    return marker
  }

  function removeMarker(id: string) {
    markers.value = markers.value.filter(m => m.id !== id)
    gc()
  }

  function setNote(id: string, note: string) {
    const marker = markers.value.find(m => m.id === id)
    if (marker) marker.note = note.trim() || undefined
  }

  function toggleStar(record: CrateRecord) {
    if (starred.value[record.id]) {
      delete starred.value[record.id]
      gc()
    } else {
      remember(record)
      starred.value[record.id] = Date.now()
    }
  }

  function isStarred(id: string): boolean {
    return !!starred.value[id]
  }

  function markersFor(recordId: string, trackName?: string): Marker[] {
    return markers.value
      .filter(m => m.recordId === recordId && (!trackName || m.trackName === trackName))
      .sort((a, b) => a.timestampSec - b.timestampSec)
  }

  /** True when any track of this record has pads assigned. */
  function hasPads(recordId: string): boolean {
    const prefix = `${recordId}::`
    return Object.keys(pads.value).some(k => k.startsWith(prefix))
  }

  /** Drops cached metadata for records nothing points at any more. */
  function gc() {
    for (const id of Object.keys(records.value)) {
      const stillWanted =
        starred.value[id] !== undefined ||
        markers.value.some(m => m.recordId === id) ||
        hasPads(id)
      if (!stillWanted) delete records.value[id]
    }
  }

  /** Records with at least one marker, most recently flagged first. */
  const flagged = computed<FlaggedGroup[]>(() => {
    const byRecord = new Map<string, Marker[]>()
    for (const m of markers.value) {
      const list = byRecord.get(m.recordId)
      if (list) list.push(m)
      else byRecord.set(m.recordId, [m])
    }

    const groups: FlaggedGroup[] = []
    for (const [recordId, list] of byRecord) {
      const record = records.value[recordId]
      if (!record) continue
      groups.push({
        record,
        markers: [...list].sort((a, b) => a.timestampSec - b.timestampSec),
      })
    }

    return groups.sort((a, b) => {
      const aLatest = Math.max(...a.markers.map(m => m.createdAt))
      const bLatest = Math.max(...b.markers.map(m => m.createdAt))
      return bLatest - aLatest
    })
  })

  const starredRecords = computed<CrateRecord[]>(() =>
    Object.entries(starred.value)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => records.value[id])
      .filter((r): r is CrateRecord => !!r),
  )

  const markerCount = computed(() => markers.value.length)

  /** Tracks carrying pad layouts, for the chopped section of the flag list. */
  const chopped = computed<ChoppedTrack[]>(() => {
    const out: ChoppedTrack[] = []
    for (const [k, bank] of Object.entries(pads.value)) {
      const at = k.indexOf('::')
      const recordId = k.slice(0, at)
      const record = records.value[recordId]
      const count = bank.reduce((n, b) => n + b.filter(Boolean).length, 0)
      if (!record || count === 0) continue
      out.push({ key: k, recordId, trackName: k.slice(at + 2), count, record })
    }
    return out.sort((a, b) => b.count - a.count)
  })

  return {
    records,
    markers,
    starred,
    unplayable,
    pads,
    trims,
    persistFailed,
    markUnplayable,
    isUnplayable,
    padsFor,
    setPad,
    bankCounts,
    clearBank,
    trimFor,
    setTrim,
    padKey,
    hasPads,
    chopped,
    remember,
    dropMarker,
    removeMarker,
    setNote,
    toggleStar,
    isStarred,
    markersFor,
    flagged,
    starredRecords,
    markerCount,
  }
})
