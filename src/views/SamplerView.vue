<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { provider } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { PAD_COUNT, padKey, type Pad } from '../stores/storage'
import { useSampler, semitonesToRate } from '../composables/useSampler'
import { makeZip, type ZipEntry } from '../lib/zip'
import { encodeWav } from '../lib/wav'
import { useAudio, formatTime } from '../composables/useAudio'
import Waveform from '../components/Waveform.vue'

const props = defineProps<{ id: string; track: string }>()
const router = useRouter()
const library = useLibrary()
const sampler = useSampler()
const audio = useAudio()

const record = ref<CrateRecord | null>(null)
const loadError = ref<string | null>(null)

interface Range {
  startSec: number
  endSec: number
}

/**
 * The working range, and deliberately not a pad.
 *
 * It's the span lazy chop cuts within, and the thing a flag sets. Pads are
 * only ever made from it — copied, never the same object — so chopping can
 * rebuild the bank without destroying the range that produced it.
 */
const trim = ref<Range | null>(null)

/** Pad under the finger, for playback highlight and pitch editing. */
const activePad = ref<number | null>(null)

const trackName = computed(() => decodeURIComponent(props.track))
const key = computed(() => padKey(props.id, trackName.value))
const bank = computed(() => library.padsFor(key.value))
const total = computed(() => sampler.buffer.value?.duration ?? 0)
const currentPad = computed<Pad | null>(() =>
  activePad.value === null ? null : (bank.value[activePad.value] ?? null),
)

const trackMeta = computed(
  () => record.value?.tracks.find(t => t.name === trackName.value) ?? null,
)

const MIN_LEN = 0.05

/* ---- zoom ---- */

const ZOOM_PAD = 0.15
const zoomed = ref(false)

/** Zoom frames whatever is being worked on: the chop range, else the trim. */
const zoomAnchor = computed<Range | null>(() => {
  if (lazy.value) return { startSec: lazyRange.value.start, endSec: lazyRange.value.end }
  return trim.value
})

/**
 * The slice of track on screen. Everything positional works against this
 * rather than the whole file, so zooming needs no separate code path.
 */
const view = computed(() => {
  const a = zoomAnchor.value
  if (!zoomed.value || !a || total.value <= 0) return { start: 0, end: total.value }
  const pad = Math.max(0.2, (a.endSec - a.startSec) * ZOOM_PAD)
  return {
    start: Math.max(0, a.startSec - pad),
    end: Math.min(total.value, a.endSec + pad),
  }
})

const canZoom = computed(() => zoomAnchor.value !== null)
const degraded = computed(() => sampler.rate.value > 0 && sampler.rate.value < 44100)

onMounted(async () => {
  // Entering the pads stops the record — two sources at once helps nobody.
  audio.pause()

  try {
    const fetched = await provider.getRecord(props.id)
    if (!fetched) {
      loadError.value = 'Record unavailable.'
      return
    }
    record.value = fetched
    const t = fetched.tracks.find(x => x.name === trackName.value)
    if (!t) {
      loadError.value = 'That track is gone.'
      return
    }
    await sampler.load(t.streamUrl, t.durationSec ?? 0)

    // Pick up exactly where this track was left. Clamped, because the
    // decoded duration can differ slightly from the metadata's.
    const saved = library.trimFor(key.value)
    if (saved && total.value > 0) {
      const start = Math.max(0, Math.min(saved.startSec, total.value - MIN_LEN))
      const end = Math.max(start + MIN_LEN, Math.min(saved.endSec, total.value))
      trim.value = { startSec: start, endSec: end }
      zoomed.value = saved.zoomed
    }
  } catch {
    loadError.value = "Couldn't open the sampler for this track."
  }
})

onBeforeUnmount(() => sampler.release())

/* ---- the strip ---- */

const strip = ref<HTMLElement | null>(null)
let mode: 'new' | 'start' | 'end' | null = null
let anchor = 0

const EDGE_GRAB_PX = 18

/**
 * The view is frozen for the duration of a drag.
 *
 * Zoom frames the trim, so without this the first pointermove rewrites the
 * trim, the window collapses onto the new tiny range, and the rest of the
 * drag maps against a scale that's shrinking under your finger.
 */
const dragView = ref<{ start: number; end: number } | null>(null)

function activeView(): { start: number; end: number } {
  return dragView.value ?? view.value
}

/**
 * Written at rest, never mid-drag: the store persists on every mutation, so
 * committing on pointermove would mean a JSON write per frame.
 */
function commitTrim() {
  library.setTrim(
    key.value,
    trim.value ? { ...trim.value, zoomed: zoomed.value } : null,
  )
}

function timeAt(e: PointerEvent): number {
  const el = strip.value
  if (!el || total.value <= 0) return 0
  const r = el.getBoundingClientRect()
  const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const v = activeView()
  return v.start + frac * Math.max(1e-6, v.end - v.start)
}

function pxPerSec(): number {
  const el = strip.value
  if (!el || total.value <= 0) return 1
  const v = activeView()
  return el.getBoundingClientRect().width / Math.max(1e-6, v.end - v.start)
}

function onDown(e: PointerEvent) {
  if (!sampler.buffer.value || lazy.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragView.value = { ...view.value }
  const t = timeAt(e)

  // Near an edge of the trim? Adjust it rather than starting a new range.
  const cur = trim.value
  if (cur) {
    const scale = pxPerSec()
    if (Math.abs(t - cur.startSec) * scale < EDGE_GRAB_PX) {
      mode = 'start'
      return
    }
    if (Math.abs(t - cur.endSec) * scale < EDGE_GRAB_PX) {
      mode = 'end'
      return
    }
  }

  mode = 'new'
  anchor = t
  trim.value = { startSec: t, endSec: t + MIN_LEN }
}

function onMove(e: PointerEvent) {
  if (!mode || !trim.value) return
  const t = timeAt(e)
  const cur = trim.value

  if (mode === 'new') {
    trim.value = {
      startSec: Math.min(anchor, t),
      endSec: Math.max(anchor + MIN_LEN, Math.max(anchor, t)),
    }
  } else if (mode === 'start') {
    trim.value = { ...cur, startSec: Math.min(t, cur.endSec - MIN_LEN) }
  } else {
    trim.value = { ...cur, endSec: Math.max(t, cur.startSec + MIN_LEN) }
  }
}

function onUp(e: PointerEvent) {
  if (!mode) return
  mode = null
  dragView.value = null
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // capture already gone
  }
  commitTrim()
  playTrim()
}

/* ---- trim controls ---- */

function nudge(edge: 'startSec' | 'endSec', delta: number) {
  const cur = trim.value
  if (!cur) return
  const next = { ...cur }
  next[edge] = Math.max(0, Math.min(total.value, next[edge] + delta))
  if (next.endSec - next.startSec < MIN_LEN) return
  trim.value = next
  commitTrim()
}

function playTrim() {
  const cur = trim.value
  if (!cur) return
  sampler.play({ ...cur, pitch: 0 }, null)
}

/** The tail of the trim, for hearing where the out point lands. */
const ROLL_SEC = 3

function roll() {
  const cur = trim.value
  if (!cur) return
  sampler.play(
    { startSec: Math.max(cur.startSec, cur.endSec - ROLL_SEC), endSec: cur.endSec, pitch: 0 },
    null,
  )
}

/** Pitch belongs to the pad, not the trim — it's a property of the sample. */
function setPitch(semitones: number) {
  const cur = currentPad.value
  if (activePad.value === null || !cur) return
  library.setPad(key.value, activePad.value, {
    ...cur,
    pitch: Math.max(-12, Math.min(12, semitones)),
  })
}

/* ---- flags ---- */

const flagsOpen = ref(false)

/**
 * Held as the raw string so typing isn't fought mid-keystroke — clamping
 * "0" up to a minimum while someone is on their way to "0.75" makes the
 * field unusable. Parsed and bounded only at the point of use.
 */
const flagLengthInput = ref('2')

const flagLength = computed(() => {
  const n = parseFloat(flagLengthInput.value)
  return Number.isFinite(n) && n > 0 ? n : 2
})

const trackFlags = computed(() =>
  record.value ? library.markersFor(record.value.id, trackName.value) : [],
)

/** Flags drawn on the strip, as track percentages — the view maps them. */
const flagPercents = computed(() =>
  total.value > 0 ? trackFlags.value.map(m => (m.timestampSec / total.value) * 100) : [],
)

/** A flag sets the range and nothing else. No pad is touched. */
function useFlag(atSec: number) {
  if (total.value <= 0) return
  const start = Math.max(0, Math.min(atSec, total.value - MIN_LEN))
  const end = Math.max(start + MIN_LEN, Math.min(total.value, start + flagLength.value))
  trim.value = { startSec: start, endSec: end }
  zoomed.value = true
  commitTrim()
  playTrim()
}

/* ---- pads ---- */

function hitPad(i: number) {
  // Mid-chop, any pad is the cut button.
  if (lazy.value) {
    lazyCut()
    return
  }

  const existing = bank.value[i]
  activePad.value = i

  if (existing) {
    sampler.play(existing, i)
  } else if (trim.value) {
    // A copy of the range, not the range itself.
    const pad: Pad = { ...trim.value, pitch: 0 }
    library.setPad(key.value, i, pad)
    if (record.value) library.remember(record.value)
    sampler.play(pad, i)
  }
}

function clearPad(i: number) {
  library.setPad(key.value, i, null)
  if (activePad.value === i) activePad.value = null
}

/* ---- lazy chop ---- */

/**
 * Lazy chopping: the trim plays through and every pad tap cuts at the
 * playhead. The first chop starts at the trim's start whether you tap or
 * not, each tap closes one chop and opens the next, and the last runs to
 * the trim's end — so N taps give N+1 chops filling pads in order.
 *
 * Not evenly spaced slicing; the cuts land where you heard them.
 */
const lazy = ref(false)
const lazyRange = ref({ start: 0, end: 0 })
const lazyBounds = ref<number[]>([])
const lazyNextPad = ref(0)

const MIN_CHOP = 0.05

function startLazyChop() {
  if (lazy.value) {
    endLazyChop()
    return
  }
  const cur = trim.value
  if (!cur || cur.endSec - cur.startSec < MIN_CHOP * 2) return

  lazyRange.value = { start: cur.startSec, end: cur.endSec }
  lazyBounds.value = [cur.startSec]
  lazyNextPad.value = 0
  for (let i = 0; i < PAD_COUNT; i++) library.setPad(key.value, i, null)
  activePad.value = null

  lazy.value = true
  zoomed.value = true
  sampler.play({ startSec: cur.startSec, endSec: cur.endSec, pitch: 0 }, null, endLazyChop)
}

/** One tap: close the open chop at the playhead, open the next. */
function lazyCut() {
  const t = sampler.playhead.value
  const last = lazyBounds.value[lazyBounds.value.length - 1] ?? lazyRange.value.start
  if (t - last < MIN_CHOP) return
  if (lazyNextPad.value >= PAD_COUNT) return

  library.setPad(key.value, lazyNextPad.value, { startSec: last, endSec: t, pitch: 0 })
  if (record.value) library.remember(record.value)
  lazyNextPad.value++
  lazyBounds.value.push(t)

  if (lazyNextPad.value >= PAD_COUNT) endLazyChop()
}

function endLazyChop() {
  if (!lazy.value) return
  lazy.value = false

  const last = lazyBounds.value[lazyBounds.value.length - 1] ?? lazyRange.value.start
  const end = lazyRange.value.end
  // The final chop always runs to the end of the trim.
  if (lazyNextPad.value < PAD_COUNT && end - last >= MIN_CHOP) {
    library.setPad(key.value, lazyNextPad.value, { startSec: last, endSec: end, pitch: 0 })
    if (record.value) library.remember(record.value)
    lazyNextPad.value++
  }
  sampler.stop()
}

/* ---- export ---- */

const exporting = ref(false)
const exportNote = ref<string | null>(null)

/**
 * Whether pitched pads export as they sound, or as the raw region.
 *
 * Applied matches what was auditioned; dry keeps the untouched material for
 * a sampler that will do its own pitching. Only offered when some pad is
 * actually pitched — otherwise the choice means nothing.
 */
const applyPitch = ref(true)
const hasPitchedPads = computed(() => bank.value.some(p => p && p.pitch !== 0))

function safeName(text: string): string {
  return text.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

const exportable = computed(
  () => !!trim.value || bank.value.some(p => p !== null),
)

/**
 * Everything cut from this track, as WAVs in a zip with a manifest.
 *
 * Pads export with their pitch applied, because that's the sound that was
 * auditioned. The manifest keeps the untouched timestamps and the source
 * URL, so anything can be re-cut at full fidelity from the original.
 */
async function exportChops() {
  const buf = sampler.buffer.value
  if (!buf || exporting.value) return

  exporting.value = true
  exportNote.value = null

  try {
    // Yield once so the button paints its busy state before the encode.
    await new Promise(r => setTimeout(r, 0))

    const entries: ZipEntry[] = []
    const manifestPads: unknown[] = []

    if (trim.value) {
      entries.push({
        name: 'trim.wav',
        data: encodeWav(buf, trim.value.startSec, trim.value.endSec),
      })
    }

    bank.value.forEach((pad, i) => {
      if (!pad) return
      const name = `pad-${String(i + 1).padStart(2, '0')}.wav`
      entries.push({
        name,
        data: encodeWav(
          buf,
          pad.startSec,
          pad.endSec,
          applyPitch.value ? semitonesToRate(pad.pitch) : 1,
        ),
      })
      manifestPads.push({
        pad: i + 1,
        file: name,
        startSec: Number(pad.startSec.toFixed(3)),
        endSec: Number(pad.endSec.toFixed(3)),
        pitchSemitones: pad.pitch,
        pitchApplied: applyPitch.value && pad.pitch !== 0,
      })
    })

    const manifest = {
      generatedAt: new Date().toISOString(),
      source: {
        identifier: props.id,
        title: record.value?.title ?? props.id,
        creator: record.value?.creator ?? 'Unknown',
        track: trackName.value,
        details: record.value?.sourceUrl,
        download: `https://archive.org/download/${props.id}/${encodeURIComponent(trackName.value)}`,
      },
      audio: {
        sampleRate: buf.sampleRate,
        channels: buf.numberOfChannels,
        bitDepth: 16,
        note:
          buf.sampleRate < 44100
            ? `Cut from a ${(buf.sampleRate / 1000).toFixed(1)}kHz decode, which is how a track this long fits in memory. Re-cut from the download URL for full fidelity.`
            : 'Cut at the source rate.',
      },
      pitch: applyPitch.value
        ? 'Applied — pads are resampled to the pitch they were auditioned at.'
        : 'Not applied — pads are the raw regions; pitchSemitones says what was set.',
      trim: trim.value
        ? {
            file: 'trim.wav',
            startSec: Number(trim.value.startSec.toFixed(3)),
            endSec: Number(trim.value.endSec.toFixed(3)),
          }
        : null,
      pads: manifestPads,
    }

    entries.push({
      name: 'manifest.json',
      data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    })

    const dry = hasPitchedPads.value && !applyPitch.value ? '-dry' : ''
    const filename = `crate-${safeName(props.id)}-${safeName(trackName.value)}${dry}.zip`
    const blob = makeZip(entries)

    // The native share sheet is both requirements at once: Save to Files
    // and Mail sit side by side in it.
    const file = new File([blob], filename, { type: 'application/zip' })
    const canShare =
      typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

    if (canShare) {
      try {
        await navigator.share({ files: [file], title: filename })
        exportNote.value = `${entries.length} files shared`
        return
      } catch (err) {
        // Dismissing the sheet is not a failure worth shouting about.
        if (err instanceof DOMException && err.name === 'AbortError') {
          exportNote.value = null
          return
        }
      }
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    exportNote.value = `${entries.length} files downloaded`
  } catch {
    exportNote.value = "Couldn't build the export."
  } finally {
    exporting.value = false
    setTimeout(() => (exportNote.value = null), 4000)
  }
}

/* ---- geometry ---- */

function pct(sec: number): number {
  const v = activeView()
  return ((sec - v.start) / Math.max(1e-6, v.end - v.start)) * 100
}

function inView(a: number, b: number): boolean {
  const v = activeView()
  return b > v.start && a < v.end
}

const trimLength = computed(() =>
  trim.value ? trim.value.endSec - trim.value.startSec : 0,
)
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex-none flex items-center gap-1 px-2 pt-safe pb-1">
      <button
        class="w-11 h-11 flex items-center justify-center text-flag-soft"
        aria-label="Back"
        @click="router.back()"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M15 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <div class="flex-1 min-w-0 px-1">
        <p class="text-[13px] text-cream truncate">{{ trackMeta?.title ?? 'Pads' }}</p>
        <p class="text-[11px] text-flag-dim truncate">{{ record?.creator }}</p>
      </div>
      <button
        class="px-3 h-9 rounded-lg border border-ink-500 text-[11px] tracking-wide
               text-flag-soft active:bg-ink-700"
        @click="sampler.stop()"
      >
        STOP
      </button>
    </header>

    <p v-if="loadError" class="px-6 py-10 text-center text-[14px] text-red-300/80">
      {{ loadError }}
    </p>
    <p v-else-if="sampler.error.value" class="px-6 py-10 text-center text-[14px] text-red-300/80">
      {{ sampler.error.value }}
    </p>

    <div
      v-else-if="sampler.loading.value"
      class="flex-1 flex flex-col items-center justify-center gap-2 px-8"
    >
      <div class="w-5 h-5 border-2 border-flag border-t-transparent rounded-full animate-spin" />
      <p class="text-[13px] text-flag-dim">
        <template v-if="sampler.progress.value !== null">
          Downloading {{ Math.round(sampler.progress.value * 100) }}%
        </template>
        <template v-else>Decoding…</template>
      </p>
    </div>

    <template v-else-if="sampler.buffer.value">
      <div class="flex-none px-4 pt-1">
        <div
          ref="strip"
          class="sel relative h-24 rounded overflow-hidden bg-ink-800"
          :class="lazy ? 'ring-2 ring-flag' : ''"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="absolute inset-0">
            <Waveform
              :peaks="sampler.peaks.value"
              :progress="0"
              :markers="flagPercents"
              :range-start="total > 0 ? view.start / total : 0"
              :range-end="total > 0 ? view.end / total : 1"
              :dense="zoomed"
            />
          </div>

          <button
            v-if="canZoom"
            class="absolute top-1 right-1 z-10 px-2 h-6 rounded border text-[9px] tracking-wide"
            :class="zoomed
              ? 'border-flag bg-ink-900/80 text-flag'
              : 'border-ink-500 bg-ink-900/70 text-flag-soft'"
            @pointerdown.stop="zoomed = !zoomed; commitTrim()"
          >
            {{ zoomed ? 'TRIM' : 'ALL' }}
          </button>

          <!-- Chops already assigned, drawn under the trim. -->
          <template v-for="(p, i) in bank" :key="i">
            <div
              v-if="p && inView(p.startSec, p.endSec)"
              class="absolute inset-y-0 pointer-events-none border-l"
              :class="sampler.playing.value === i
                ? 'bg-flag/45 border-cream'
                : 'bg-flag/10 border-flag/40'"
              :style="{ left: `${pct(p.startSec)}%`, width: `${pct(p.endSec) - pct(p.startSec)}%` }"
            >
              <span class="absolute top-0.5 left-1 text-[9px] tabular-nums text-cream/80">
                {{ i + 1 }}
              </span>
            </div>
          </template>

          <!-- The trim: the range chopping works inside. -->
          <template v-if="trim">
            <div
              class="absolute inset-y-0 border-x-2 border-cream pointer-events-none
                     transition-colors"
              :class="sampler.active.value && sampler.playing.value === null
                ? 'bg-cream/30'
                : 'bg-cream/10'"
              :style="{
                left: `${pct(trim.startSec)}%`,
                width: `${pct(trim.endSec) - pct(trim.startSec)}%`,
              }"
            />
          </template>

          <div
            v-if="sampler.active.value || lazy"
            class="absolute inset-y-0 w-0.5 bg-flag pointer-events-none"
            :style="{ left: `${pct(sampler.playhead.value)}%` }"
          />

          <p
            v-if="lazy"
            class="absolute inset-x-0 bottom-0 text-center text-[10px] py-0.5
                   text-ink-900 bg-flag/90 pointer-events-none"
          >
            Tap any pad to cut · {{ lazyNextPad }} chopped
          </p>
        </div>

        <div v-if="lazy" class="mt-2">
          <button
            class="w-full h-12 rounded-lg bg-flag text-ink-900 text-[14px] font-semibold
                   active:scale-[0.99] transition-transform"
            @click="endLazyChop"
          >
            DONE CHOPPING
          </button>
        </div>

        <div
          v-if="!lazy"
          class="flex items-center justify-between mt-1 text-[11px] tabular-nums text-flag-dim"
        >
          <span>{{ trim ? formatTime(trim.startSec) : '—' }}</span>
          <span class="text-cream">
            <template v-if="trim">Trim · {{ trimLength.toFixed(2) }}s</template>
            <template v-else>Drag the waveform, or tap a flag</template>
          </span>
          <span>{{ trim ? formatTime(trim.endSec) : '—' }}</span>
        </div>

        <div v-if="!lazy" class="flex items-center gap-1.5 mt-2">
          <span class="text-[10px] text-ink-500 w-4">IN</span>
          <button class="trim" :disabled="!trim" @click="nudge('startSec', -0.1)">−</button>
          <button class="trim" :disabled="!trim" @click="nudge('startSec', 0.1)">+</button>
          <span class="flex-1" />
          <button class="trim" :disabled="!trim" @click="nudge('endSec', -0.1)">−</button>
          <button class="trim" :disabled="!trim" @click="nudge('endSec', 0.1)">+</button>
          <span class="text-[10px] text-ink-500 w-6 text-right">OUT</span>
        </div>

        <div v-if="!lazy" class="flex items-center gap-2 mt-2">
          <button
            class="flex-1 h-10 rounded-lg bg-ink-600 text-cream text-[13px]
                   active:bg-ink-500 disabled:opacity-40"
            :disabled="!trim"
            @click="playTrim"
          >
            Play
          </button>
          <button
            class="flex-1 h-10 rounded-lg border border-ink-500 text-flag-soft text-[13px]
                   active:bg-ink-700 disabled:opacity-40"
            :disabled="!trim"
            @click="roll"
          >
            Roll
          </button>
          <button
            class="px-3 h-10 rounded-lg border border-ink-500 text-flag-soft text-[11px]
                   tracking-wide active:bg-ink-700 disabled:opacity-40"
            :disabled="!trim"
            title="Play the trim and cut on the fly"
            @click="startLazyChop"
          >
            CHOP
          </button>
        </div>

        <!-- Pitch is the selected pad's, not the trim's. -->
        <div v-if="!lazy" class="flex items-center gap-2 mt-2">
          <span class="text-[10px] text-ink-500 w-9">PITCH</span>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            :value="currentPad?.pitch ?? 0"
            :disabled="!currentPad"
            class="flex-1 accent-[#d99a4e] disabled:opacity-40"
            aria-label="Pitch in semitones"
            @input="setPitch(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="w-16 text-right text-[11px] tabular-nums text-flag">
            <template v-if="currentPad">
              pad {{ activePad! + 1 }} {{ currentPad.pitch > 0 ? '+' : '' }}{{ currentPad.pitch }}
            </template>
            <template v-else>—</template>
          </span>
        </div>
      </div>

      <div class="flex-1 min-h-0 px-4 pt-3 pb-safe overflow-y-auto">
        <!-- Flags for this track. Tapping one sets the range, nothing else. -->
        <div v-if="!lazy && trackFlags.length" class="mb-3 rounded-lg border border-ink-600">
          <button
            class="w-full flex items-center justify-between px-3 py-2 text-left"
            @click="flagsOpen = !flagsOpen"
          >
            <span class="text-[11px] uppercase tracking-wider text-flag">
              Flags · {{ trackFlags.length }}
            </span>
            <svg
              class="w-4 h-4 text-ink-500 transition-transform"
              :class="flagsOpen ? 'rotate-180' : ''"
              fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
            >
              <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div v-if="flagsOpen" class="px-3 pb-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="text-[10px] text-ink-500">LENGTH</span>
              <input
                v-model="flagLengthInput"
                type="number"
                inputmode="decimal"
                step="0.1"
                min="0.1"
                class="w-24 h-9 px-2 rounded bg-ink-700 text-cream text-[15px] tabular-nums
                       border border-ink-600 focus:outline-none focus:border-flag-dim"
                aria-label="Trim length in seconds"
              />
              <span class="text-[12px] text-flag-dim">seconds</span>
            </div>

            <button
              v-for="m in trackFlags"
              :key="m.id"
              class="w-full flex items-center gap-2 px-2 py-2 rounded text-left
                     border-t border-ink-700/50 active:bg-ink-700"
              @click="useFlag(m.timestampSec)"
            >
              <span class="text-[13px] tabular-nums text-flag w-14">
                {{ formatTime(m.timestampSec) }}
              </span>
              <span class="flex-1 min-w-0 truncate text-[12px] text-flag-dim">
                {{ m.note || 'flagged' }}
              </span>
              <span class="text-[10px] text-ink-500">→ trim</span>
            </button>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="i in PAD_COUNT"
            :key="i - 1"
            class="relative aspect-square rounded-lg border text-[11px] tabular-nums
                   flex items-center justify-center transition-colors"
            :class="[
              bank[i - 1]
                ? 'border-flag bg-flag/15 text-flag'
                : 'border-ink-600 bg-ink-800 text-ink-500',
              activePad === i - 1 ? 'ring-2 ring-flag' : '',
              sampler.playing.value === i - 1 ? '!bg-flag !text-ink-900' : '',
            ]"
            @pointerdown="hitPad(i - 1)"
          >
            <span class="absolute top-1 left-1.5 text-[9px] opacity-60">{{ i }}</span>
            <span v-if="bank[i - 1]" class="leading-tight text-center">
              {{ (bank[i - 1]!.endSec - bank[i - 1]!.startSec).toFixed(1) }}s
              <span v-if="bank[i - 1]!.pitch" class="block text-[9px]">
                {{ bank[i - 1]!.pitch > 0 ? '+' : '' }}{{ bank[i - 1]!.pitch }}
              </span>
            </span>
            <span
              v-if="bank[i - 1]"
              class="absolute top-0 right-0 w-7 h-7 flex items-center justify-center
                     text-ink-500 text-[13px]"
              role="button"
              aria-label="Clear pad"
              @pointerdown.stop="clearPad(i - 1)"
            >
              ×
            </span>
          </button>
        </div>

        <!-- Only worth asking when something is actually pitched. -->
        <div
          v-if="exportable && !lazy && hasPitchedPads"
          class="flex items-center gap-2 mt-3"
        >
          <span class="text-[10px] text-ink-500 flex-none">PITCH</span>
          <button
            v-for="opt in [true, false]"
            :key="String(opt)"
            class="flex-1 h-9 rounded text-[12px] border transition-colors"
            :class="applyPitch === opt
              ? 'bg-flag text-ink-900 border-flag font-medium'
              : 'border-ink-500 text-flag-soft active:bg-ink-700'"
            @click="applyPitch = opt"
          >
            {{ opt ? 'Applied' : 'Dry' }}
          </button>
        </div>

        <button
          v-if="exportable && !lazy"
          class="w-full h-12 mt-2 rounded-lg bg-flag text-ink-900 text-[14px] font-semibold
                 active:scale-[0.99] transition-transform disabled:opacity-50"
          :disabled="exporting"
          @click="exportChops"
        >
          {{ exporting ? 'BUILDING…' : 'EXPORT CHOPS' }}
        </button>
        <p v-if="exportNote" class="text-center text-[11px] text-flag mt-2">
          {{ exportNote }}
        </p>

        <p class="text-center text-[10px] text-ink-500 mt-3 leading-relaxed">
          Set a trim, then CHOP it. An empty pad takes a copy of the trim.
          <span v-if="degraded" class="block">
            Decoded at {{ (sampler.rate.value / 1000).toFixed(1) }}kHz to fit in memory.
          </span>
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sel {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.trim {
  @apply w-9 h-9 rounded bg-ink-700 text-cream text-[15px] leading-none
         active:bg-ink-600 flex-none disabled:opacity-40;
}
</style>
