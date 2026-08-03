<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { provider } from '../providers'
import type { Record as CrateRecord, Marker } from '../providers/types'
import { useLibrary } from '../stores/library'
import { useAudio, formatTime } from '../composables/useAudio'
import {
  useWaveform,
  waveformTier,
  estimateBytes,
  formatBytes,
} from '../composables/useWaveform'
import Waveform from '../components/Waveform.vue'
import HelpButton from '../components/HelpButton.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const library = useLibrary()
const audio = useAudio()
const wave = useWaveform()

const record = ref<CrateRecord | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const trackIndex = ref(0)
const justFlagged = ref<string | null>(null)
const scrubbing = ref(false)
const scrubValue = ref(0)
const showMarkers = ref(false)
/** Set when jumping to a marker on a track that has to load first. */
const pendingSeek = ref<number | null>(null)

const track = computed(() => record.value?.tracks[trackIndex.value] ?? null)
const starred = computed(() => (record.value ? library.isStarred(record.value.id) : false))

/** Markers on the track currently loaded, for the scrubber ticks. */
const trackMarkers = computed(() => {
  if (!record.value || !track.value) return []
  return library.markersFor(record.value.id, track.value.name)
})

/** Everything flagged on this record, for the panel. */
const recordMarkers = computed(() => {
  if (!record.value) return []
  const order = new Map(record.value.tracks.map((t, i) => [t.name, i]))
  return [...library.markersFor(record.value.id)].sort((a, b) => {
    const ta = order.get(a.trackName) ?? 0
    const tb = order.get(b.trackName) ?? 0
    return ta === tb ? a.timestampSec - b.timestampSec : ta - tb
  })
})

/** Track number for a marker, so the panel can show where it sits. */
function trackNoFor(m: Marker): number | null {
  const i = record.value?.tracks.findIndex(t => t.name === m.trackName) ?? -1
  return i < 0 ? null : i + 1
}

const tier = computed(() => waveformTier(total.value))
const showWaveButton = computed(
  () => !wave.peaks.value && !wave.loading.value && tier.value !== 'too-long',
)
const waveCost = computed(() => formatBytes(estimateBytes(total.value)))

/** Marker positions as percentages, for the waveform overlay. */
const markerPercents = computed(() =>
  total.value > 0
    ? trackMarkers.value.map(m => (m.timestampSec / total.value) * 100)
    : [],
)

function loadWave() {
  if (track.value) void wave.load(track.value.streamUrl)
}

// A different file means a different waveform. Cached ones come back free.
watch(
  () => track.value?.streamUrl ?? null,
  url => wave.reset(url),
  { immediate: true },
)

const total = computed(() => audio.effectiveDuration.value)
const displayPos = computed(() => (scrubbing.value ? scrubValue.value : audio.position.value))
const pct = computed(() => (total.value > 0 ? (displayPos.value / total.value) * 100 : 0))

/** True when this view's track is the one actually loaded in the element. */
const isCurrent = computed(
  () => !!track.value && audio.currentTrack.value?.streamUrl === track.value.streamUrl,
)

onMounted(async () => {
  const cached = library.records[props.id]
  if (cached?.tracks.length) {
    record.value = cached
    loading.value = false
  }

  try {
    const fetched = await provider.getRecord(props.id)
    if (!fetched) {
      // Nothing here can be played. Remember it so it stays out of listings,
      // and get out rather than parking the user on a dead end.
      library.markUnplayable(props.id)
      error.value = 'Nothing playable on this one — putting it back.'
      setTimeout(() => router.back(), 900)
      return
    }
    record.value = fetched
    if (library.records[props.id]) library.remember(fetched)
  } catch {
    if (!record.value) error.value = "Couldn't load this record."
  } finally {
    loading.value = false
  }

  if (!record.value?.tracks.length) return

  // Coming back to something already playing must not restart it. Adopt the
  // track that's actually loaded; only start from the top if this record
  // isn't the one on the deck.
  const playing = audio.currentTrack.value?.streamUrl
  const resumeAt = playing
    ? record.value.tracks.findIndex(t => t.streamUrl === playing)
    : -1

  if (resumeAt >= 0) trackIndex.value = resumeAt
  else void openTrack(0)
})

async function openTrack(index: number) {
  if (!record.value) return
  const t = record.value.tracks[index]
  if (!t) return
  trackIndex.value = index
  await audio.load(record.value, t, true)
}

/**
 * Seconds either side of the playhead shown in the magnifier. A fixed time
 * window rather than a fraction, so it means the same thing on a 3-minute
 * 78 and a 50-minute set.
 */
const ZOOM_HALF_SEC = 8

const scrubBar = ref<HTMLElement | null>(null)

function timeFromPointer(e: PointerEvent): number {
  const el = scrubBar.value
  if (!el || total.value <= 0) return 0
  const r = el.getBoundingClientRect()
  const frac = (e.clientX - r.left) / r.width
  return Math.min(1, Math.max(0, frac)) * total.value
}

const canScrub = computed(() => isCurrent.value && total.value > 0)

/* ---- dropping the needle ---- */

/**
 * Both ends are left out of the draw.
 *
 * The lead-in and the run-out are the two parts of a record with nothing on
 * them, and landing four seconds from the end would be over before you'd
 * worked out what you were hearing.
 */
const DROP_HEAD_SEC = 3
const DROP_TAIL_SEC = 12
/** How far a new spot has to be from the old one to feel like a move. */
const DROP_APART = 0.12

/**
 * What to aim at: the loaded length, or what the listing claims when this
 * track isn't the one playing yet.
 */
const dropTotal = computed(() =>
  isCurrent.value ? total.value : (track.value?.durationSec ?? 0),
)
const canDrop = computed(() => !!track.value && dropTotal.value > 0)

function randomSpot(length: number, avoid: number): number {
  const from = Math.min(DROP_HEAD_SEC, length * 0.05)
  const to = Math.max(from + 0.5, length - Math.min(DROP_TAIL_SEC, length * 0.1))
  const span = to - from

  let at = from + Math.random() * span
  // A few retries rather than a loop: on a very short track every spot is
  // close to every other one, and insisting would spin forever.
  for (let i = 0; i < 4 && Math.abs(at - avoid) < span * DROP_APART; i++) {
    at = from + Math.random() * span
  }
  return at
}

/** Somewhere in the middle, at random, playing. */
async function dropNeedle() {
  if (!canDrop.value) return
  const at = randomSpot(dropTotal.value, isCurrent.value ? audio.position.value : -1)

  if (isCurrent.value) {
    audio.seek(at)
    if (!audio.isPlaying.value) await audio.play()
    return
  }

  // Nothing loaded yet, so the seek waits on metadata the same way a jump
  // to a flag does.
  pendingSeek.value = at
  await openTrack(trackIndex.value)
}

function onScrubDown(e: PointerEvent) {
  if (!canScrub.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  scrubbing.value = true
  scrubValue.value = timeFromPointer(e)
}

function onScrubMove(e: PointerEvent) {
  if (!scrubbing.value) return
  scrubValue.value = timeFromPointer(e)
}

/** Commit on release, so holding to read the magnifier doesn't jump you. */
function onScrubUp(e: PointerEvent) {
  if (!scrubbing.value) return
  audio.seek(scrubValue.value)
  scrubbing.value = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // capture may already be gone
  }
}

function onScrubKey(e: KeyboardEvent) {
  if (!canScrub.value) return
  const step = e.shiftKey ? 30 : 5
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    audio.nudge(-step)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    audio.nudge(step)
  }
}

/** Magnifier window as track fractions. Allowed past 0..1 to stay centred. */
const zoomRange = computed(() => {
  if (total.value <= 0) return { start: 0, end: 1 }
  const centre = displayPos.value / total.value
  const half = ZOOM_HALF_SEC / total.value
  return { start: centre - half, end: centre + half }
})

/** The core interaction. One tap, no modal, no confirmation. */
function flag() {
  if (!record.value || !track.value) return
  const at = isCurrent.value ? audio.position.value : 0
  library.dropMarker(record.value, track.value.name, at)
  justFlagged.value = formatTime(at)
  setTimeout(() => {
    if (justFlagged.value === formatTime(at)) justFlagged.value = null
  }, 1600)
}


/**
 * Typed text is held locally until it's committed.
 *
 * The field binds :value, and the panel re-renders on every position tick
 * while a track plays — so Vue kept resetting the input back to the stored
 * note and each keystroke vanished. Keeping a draft means the bound value
 * always matches what's in the field, so there's nothing to overwrite.
 */
const noteDrafts = ref<{ [id: string]: string }>({})

function noteValue(m: { id: string; note?: string }): string {
  return noteDrafts.value[m.id] ?? m.note ?? ''
}

function onNoteInput(id: string, value: string) {
  noteDrafts.value[id] = value
}

function commitNote(id: string) {
  const draft = noteDrafts.value[id]
  if (draft === undefined) return
  library.setNote(id, draft)
  delete noteDrafts.value[id]
}

/** True when playback is sitting on this flag, within a beat or so. */
function atMarker(m: Marker): boolean {
  if (!isCurrent.value || !track.value || m.trackName !== track.value.name) return false
  return Math.abs(audio.position.value - m.timestampSec) < 1.5
}

/** Jump back to something already flagged, switching track if needed. */
async function jumpTo(m: Marker) {
  const i = record.value?.tracks.findIndex(t => t.name === m.trackName) ?? -1
  if (i < 0) return
  if (i === trackIndex.value && isCurrent.value) {
    audio.seek(m.timestampSec)
    return
  }
  pendingSeek.value = m.timestampSec
  await openTrack(i)
}

// A freshly loaded track has no seekable range until metadata lands.
watch(
  () => audio.duration.value,
  d => {
    if (d > 0 && pendingSeek.value !== null) {
      audio.seek(pendingSeek.value)
      pendingSeek.value = null
    }
  },
)

// Re-flagging the same spot twice should still read as a fresh confirmation.
watch(trackIndex, () => {
  justFlagged.value = null
})
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
        <p class="text-[13px] text-cream truncate">{{ record?.title ?? '…' }}</p>
        <p class="text-[11px] text-flag-dim truncate">{{ record?.creator }}</p>
      </div>

      <button
        v-if="record"
        class="w-11 h-11 flex items-center justify-center"
        :aria-label="starred ? 'Unstar' : 'Star'"
        @click="library.toggleStar(record)"
      >
        <svg
          class="w-6 h-6"
          :class="starred ? 'text-flag' : 'text-ink-500'"
          :fill="starred ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="1.6"
          viewBox="0 0 24 24"
        >
          <path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.87L12 16.9l-5.25 2.77 1-5.87L3.5 9.66l5.9-.86z" stroke-linejoin="round" />
        </svg>
      </button>

      <HelpButton topic="player" />
    </header>

    <p v-if="error" class="px-6 py-10 text-center text-[14px] text-red-300/80">{{ error }}</p>
    <p v-else-if="loading" class="px-6 py-10 text-center text-[13px] text-flag-dim">Loading…</p>

    <template v-else-if="record">
      <!-- Scrolls, so the panel can grow without pushing the controls off. -->
      <div class="flex-1 min-h-0 scroll-y">
        <div class="flex flex-col items-center px-6 pt-3 gap-3">
          <div
            class="w-full max-w-[min(52vw,260px)] aspect-square rounded-lg overflow-hidden
                   bg-ink-700 shadow-2xl shadow-black/60"
          >
            <img
              v-if="record.artworkUrl"
              :src="record.artworkUrl"
              alt=""
              class="w-full h-full object-cover"
              @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
            />
          </div>

          <p class="text-[13px] text-cream text-center line-clamp-2 px-2">
            {{ track?.title ?? '' }}
          </p>
        </div>

        <!-- Flagged spots on this record — same shape as the Flagged screen. -->
        <div v-if="recordMarkers.length" class="mt-4 border-t border-ink-700">
          <button
            class="w-full flex items-center justify-between px-4 py-3 text-left active:bg-ink-700"
            @click="showMarkers = !showMarkers"
          >
            <span class="text-[12px] uppercase tracking-wider text-flag">
              Flagged · {{ recordMarkers.length }}
            </span>
            <svg
              class="w-5 h-5 text-ink-500 transition-transform"
              :class="showMarkers ? 'rotate-180' : ''"
              fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
            >
              <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div v-if="showMarkers" class="pb-2 bg-ink-800/60">
            <div
              v-for="m in recordMarkers"
              :key="m.id"
              class="flex items-center gap-2 px-3 py-2 border-t border-ink-700/40"
            >
              <!-- The jump target. Bordered and carrying a glyph so it reads
                   as something to press, not just a printed timestamp. -->
              <button
                class="flex-none h-9 pl-1.5 pr-2 rounded border inline-flex items-center gap-1
                       text-[13px] tabular-nums transition-colors"
                :class="atMarker(m)
                  ? 'bg-flag text-ink-900 border-flag'
                  : 'text-flag border-ink-500 active:bg-ink-700'"
                :aria-label="`Jump to ${formatTime(m.timestampSec)}`"
                @click="jumpTo(m)"
              >
                <svg class="w-3 h-3 flex-none" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <span
                  v-if="record.tracks.length > 1 && trackNoFor(m)"
                  class="text-[11px] opacity-60"
                >
                  {{ trackNoFor(m) }}·
                </span>
                {{ formatTime(m.timestampSec) }}
              </button>

              <input
                :value="noteValue(m)"
                placeholder="note…"
                class="flex-1 min-w-0 h-9 px-2 rounded bg-ink-700 text-[13px] text-cream
                       placeholder:text-ink-500 border border-ink-600
                       focus:outline-none focus:border-flag-dim"
                @input="onNoteInput(m.id, ($event.target as HTMLInputElement).value)"
                @change="commitNote(m.id)"
                @blur="commitNote(m.id)"
              />

              <button
                class="w-9 h-9 flex-none flex items-center justify-center text-ink-500 active:text-red-300"
                aria-label="Remove flag"
                @click="library.removeMarker(m.id)"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="h-2" />
      </div>

      <!-- Track picker, only when the item actually has several files. -->
      <div
        v-if="record.tracks.length > 1"
        class="flex-none flex gap-2 px-3 py-2 overflow-x-auto no-bar border-t border-ink-700"
      >
        <button
          v-for="(t, i) in record.tracks"
          :key="t.name"
          class="flex-none px-3 h-9 rounded-full text-[12px] border max-w-[45vw] truncate"
          :class="
            i === trackIndex
              ? 'bg-flag text-ink-900 border-flag font-medium'
              : 'text-flag-soft border-ink-500 active:bg-ink-700'
          "
          @click="openTrack(i)"
        >
          {{ i + 1 }}. {{ t.title }}
        </button>
      </div>

      <!-- Bottom third: all controls. -->
      <div class="flex-none px-5 pt-3 pb-safe bg-ink-800 border-t border-ink-700">
      <div class="flex items-center gap-2.5">
        <!-- Drop the needle: somewhere in the middle, at random. -->
        <button
          class="w-11 h-11 flex-none flex items-center justify-center rounded-lg
                 border border-ink-500 text-flag-soft active:bg-ink-700
                 disabled:opacity-30"
          :disabled="!canDrop"
          aria-label="Play a random moment"
          title="Drop the needle somewhere"
          @click="dropNeedle"
        >
          <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="13" r="8" stroke-width="1.6" />
            <circle cx="11" cy="13" r="1.5" fill="currentColor" stroke="none" />
            <path d="M21 3.5 L14.4 10.1" stroke-width="1.8" stroke-linecap="round" />
            <circle cx="14.2" cy="10.3" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </button>

        <!-- Waveform when loaded, flat bar when not — same scrub surface. -->
        <div
          ref="scrubBar"
          class="scrub flex-1 min-w-0 relative flex items-center transition-[height] duration-300"
          :class="[wave.peaks.value ? 'h-14' : 'h-6', canScrub ? '' : 'opacity-40']"
          role="slider"
          tabindex="0"
          aria-label="Seek"
          :aria-valuemin="0"
          :aria-valuemax="Math.round(total)"
          :aria-valuenow="Math.round(displayPos)"
          :aria-valuetext="formatTime(displayPos)"
          @pointerdown="onScrubDown"
          @pointermove="onScrubMove"
          @pointerup="onScrubUp"
          @pointercancel="onScrubUp"
          @keydown="onScrubKey"
        >
          <!-- overflow-hidden here, not on the bar: the magnifier is a
               sibling and has to overflow upward. -->
          <div class="absolute inset-0 overflow-hidden">
            <Waveform :peaks="wave.peaks.value" :progress="pct" :markers="markerPercents" />
          </div>

          <!-- Magnifier: hold to read the exact spot before committing. -->
          <div
            v-if="scrubbing"
            class="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none z-10"
            :style="{ left: `clamp(76px, ${pct}%, calc(100% - 76px))` }"
          >
            <div class="w-[152px] rounded-lg bg-ink-900/95 border border-ink-500 shadow-xl p-1.5">
              <div v-if="wave.peaks.value" class="h-9 rounded overflow-hidden bg-ink-800">
                <Waveform
                  :peaks="wave.peaks.value"
                  :progress="pct"
                  :markers="markerPercents"
                  :range-start="zoomRange.start"
                  :range-end="zoomRange.end"
                  dense
                />
              </div>
              <p class="text-center text-[15px] tabular-nums text-cream leading-tight mt-1">
                {{ formatTime(displayPos) }}
              </p>
            </div>
          </div>
        </div>
      </div>

        <div class="flex justify-between items-center text-[11px] text-flag-dim tabular-nums mt-1">
          <span>{{ formatTime(displayPos) }}</span>

          <!-- Opt-in, and honest about what it costs before you tap it. -->
          <button
            v-if="showWaveButton"
            class="px-2 h-6 rounded border border-ink-500 text-[10px] tracking-wide
                   text-flag-soft active:bg-ink-700"
            @click="loadWave"
          >
            WAVEFORM<span v-if="tier === 'offered'" class="text-ink-500"> ~{{ waveCost }}</span>
          </button>

          <span v-else-if="wave.loading.value" class="text-[10px] text-flag-soft">
            <template v-if="wave.progress.value !== null">
              {{ Math.round(wave.progress.value * 100) }}%
            </template>
            <template v-else>decoding…</template>
          </span>

          <span v-else-if="wave.error.value" class="text-[10px] text-red-300/70">
            no waveform
          </span>

          <button
            v-if="track"
            class="px-2 h-6 rounded border border-ink-500 text-[10px] tracking-wide
                   text-flag-soft active:bg-ink-700"
            @click="router.push(`/r/${record!.id}/pads/${encodeURIComponent(track.name)}`)"
          >
            PADS
          </button>

          <span>{{ total ? formatTime(total) : '--:--' }}</span>
        </div>

        <div class="flex items-center justify-center gap-6 mt-2">
          <button
            class="w-12 h-12 flex items-center justify-center text-flag-soft active:text-cream"
            aria-label="Back 10 seconds"
            @click="audio.nudge(-10)"
          >
            <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path d="M11 8L6 12l5 4V8zM18 8l-5 4 5 4V8z" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button
            class="w-16 h-16 rounded-full bg-ink-600 flex items-center justify-center
                   text-cream active:bg-ink-500"
            :aria-label="audio.isPlaying.value ? 'Pause' : 'Play'"
            @click="audio.toggle()"
          >
            <svg v-if="audio.isLoading.value" class="w-6 h-6 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M12 3a9 9 0 109 9" stroke-linecap="round" />
            </svg>
            <svg v-else-if="audio.isPlaying.value" class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
            </svg>
            <svg v-else class="w-7 h-7 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>

          <button
            class="w-12 h-12 flex items-center justify-center text-flag-soft active:text-cream"
            aria-label="Forward 10 seconds"
            @click="audio.nudge(10)"
          >
            <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path d="M13 8l5 4-5 4V8zM6 8l5 4-5 4V8z" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>

        <!-- The reason the app exists. Biggest target on the screen. -->
        <button
          class="relative w-full h-16 mt-3 rounded-xl bg-flag text-ink-900
                 text-[17px] font-semibold tracking-wide
                 active:scale-[0.98] transition-transform disabled:opacity-40"
          :disabled="!track"
          @click="flag"
        >
          <span v-if="justFlagged">FLAGGED {{ justFlagged }}</span>
          <span v-else>FLAG THIS</span>
        </button>

        <p v-if="audio.error.value" class="text-[11px] text-red-300/80 text-center mt-2">
          {{ audio.error.value }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * Dragging is handled with pointer events rather than a native range input.
 *
 * A range input insets its thumb so it can't overflow the track, so its
 * value maps to (width - thumbWidth) while the waveform spans the full
 * width — the finger and the playhead could never line up, worst at the
 * ends of a track. Reading pointer x directly makes that mapping exact.
 *
 * touch-action: none is what actually makes the drag work on a phone;
 * without it the browser claims the gesture for scrolling.
 */
.scrub {
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.scrub:focus-visible {
  outline: 2px solid #8a7454;
  outline-offset: 3px;
}
</style>
