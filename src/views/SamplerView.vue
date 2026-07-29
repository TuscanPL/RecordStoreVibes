<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { provider } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { PAD_COUNT, padKey, type Pad } from '../stores/storage'
import { useSampler } from '../composables/useSampler'
import { useAudio, formatTime } from '../composables/useAudio'
import Waveform from '../components/Waveform.vue'

const props = defineProps<{ id: string; track: string }>()
const router = useRouter()
const library = useLibrary()
const sampler = useSampler()
const audio = useAudio()

const record = ref<CrateRecord | null>(null)
const loadError = ref<string | null>(null)

/** The pad being worked on. Dragging the waveform writes into this one. */
const activePad = ref(0)

const trackName = computed(() => decodeURIComponent(props.track))
const key = computed(() => padKey(props.id, trackName.value))
const bank = computed(() => library.padsFor(key.value))
const total = computed(() => sampler.buffer.value?.duration ?? 0)
const current = computed<Pad | null>(() => bank.value[activePad.value] ?? null)

const trackMeta = computed(
  () => record.value?.tracks.find(t => t.name === trackName.value) ?? null,
)

/* ---- zoom ---- */

/** Seconds of context shown either side, as a share of the region. */
const ZOOM_PAD = 0.15

const zoomed = ref(false)

/** What zoom frames: the range being chopped, else the current chop. */
const zoomAnchor = computed<{ start: number; end: number } | null>(() => {
  if (lazy.value) return lazyRange.value
  const cur = current.value
  return cur ? { start: cur.startSec, end: cur.endSec } : null
})

/**
 * The slice of track on screen. Everything positional works against this
 * rather than the whole file, so zooming needs no separate code path.
 */
const view = computed(() => {
  const a = zoomAnchor.value
  if (!zoomed.value || !a || total.value <= 0) return { start: 0, end: total.value }
  const pad = Math.max(0.2, (a.end - a.start) * ZOOM_PAD)
  return {
    start: Math.max(0, a.start - pad),
    end: Math.min(total.value, a.end + pad),
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
  } catch {
    loadError.value = "Couldn't open the sampler for this track."
  }
})

onBeforeUnmount(() => sampler.release())

/* ---- the strip ---- */

const strip = ref<HTMLElement | null>(null)
/** null = not dragging, 'new' = fresh region, 'start'/'end' = trimming an edge. */
let mode: 'new' | 'start' | 'end' | null = null
let anchor = 0

const EDGE_GRAB_PX = 18
const MIN_LEN = 0.05

/**
 * The view is frozen for the duration of a drag.
 *
 * Zoom frames the chop being edited, so without this the first pointermove
 * rewrites the chop, the window collapses onto the new tiny region, and the
 * rest of the drag maps against a scale that's shrinking under your finger.
 */
const dragView = ref<{ start: number; end: number } | null>(null)

function activeView(): { start: number; end: number } {
  return dragView.value ?? view.value
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

function writePad(pad: Pad) {
  library.setPad(key.value, activePad.value, pad)
}

function onDown(e: PointerEvent) {
  if (!sampler.buffer.value || lazy.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragView.value = { ...view.value }
  const t = timeAt(e)

  // Near an edge of the current chop? Trim it instead of starting a new one.
  const cur = current.value
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
  writePad({ startSec: t, endSec: t + MIN_LEN, pitch: cur?.pitch ?? 0 })
}

function onMove(e: PointerEvent) {
  if (!mode) return
  const t = timeAt(e)
  const cur = current.value
  if (!cur) return

  if (mode === 'new') {
    writePad({
      ...cur,
      startSec: Math.min(anchor, t),
      endSec: Math.max(anchor + MIN_LEN, Math.max(anchor, t)),
    })
  } else if (mode === 'start') {
    writePad({ ...cur, startSec: Math.min(t, cur.endSec - MIN_LEN) })
  } else {
    writePad({ ...cur, endSec: Math.max(t, cur.startSec + MIN_LEN) })
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
  if (current.value) sampler.play(current.value, activePad.value)
}

/* ---- trim / pitch ---- */

function nudge(edge: 'startSec' | 'endSec', delta: number) {
  const cur = current.value
  if (!cur) return
  const next = { ...cur }
  next[edge] = Math.max(0, Math.min(total.value, next[edge] + delta))
  if (next.endSec - next.startSec < MIN_LEN) return
  writePad(next)
}

function setPitch(semitones: number) {
  const cur = current.value
  if (!cur) return
  writePad({ ...cur, pitch: Math.max(-12, Math.min(12, semitones)) })
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
  if (existing) sampler.play(existing, i)
}

function clearPad(i: number) {
  library.setPad(key.value, i, null)
}

/* ---- lazy chop ---- */

/**
 * Lazy chopping: the trimmed range plays through and every pad tap cuts at
 * the playhead. The first chop starts at the trim's start whether you tap
 * or not, each tap closes one chop and opens the next, and the last runs to
 * the trim's end — so N taps give N+1 chops filling pads in order.
 *
 * Not the same as evenly spaced auto-slicing; the point is that the cuts
 * land where you heard them, not on a grid.
 */
const lazy = ref(false)
const lazyRange = ref({ start: 0, end: 0 })
/** Cut points so far. Always begins with the range start. */
const lazyBounds = ref<number[]>([])
const lazyNextPad = ref(0)

const MIN_CHOP = 0.05

function startLazyChop() {
  if (lazy.value) {
    endLazyChop()
    return
  }
  const cur = current.value
  const start = cur ? cur.startSec : 0
  const end = cur ? cur.endSec : total.value
  if (end - start < MIN_CHOP * 2) return

  // Captured before clearing: the range lives in a pad we're about to wipe.
  lazyRange.value = { start, end }
  lazyBounds.value = [start]
  lazyNextPad.value = 0
  for (let i = 0; i < PAD_COUNT; i++) library.setPad(key.value, i, null)

  lazy.value = true
  zoomed.value = true
  sampler.play({ startSec: start, endSec: end, pitch: 0 }, null, endLazyChop)
}

/** One tap: close the open chop at the playhead, open the next. */
function lazyCut() {
  const t = sampler.playhead.value
  const last = lazyBounds.value[lazyBounds.value.length - 1] ?? lazyRange.value.start
  if (t - last < MIN_CHOP) return
  if (lazyNextPad.value >= PAD_COUNT) return

  library.setPad(key.value, lazyNextPad.value, { startSec: last, endSec: t, pitch: 0 })
  lazyNextPad.value++
  lazyBounds.value.push(t)

  // Bank full — nothing left to cut into.
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
    lazyNextPad.value++
  }
  sampler.stop()
  activePad.value = 0
}

/** Position within the visible slice, not the whole track. */
function pct(sec: number): number {
  const v = activeView()
  return ((sec - v.start) / Math.max(1e-6, v.end - v.start)) * 100
}

/** True when a region overlaps what's on screen at all. */
function inView(a: number, b: number): boolean {
  const v = activeView()
  return b > v.start && a < v.end
}

/** Plays the tail of the trim, for checking where the out point lands. */
const ROLL_SEC = 3

function roll() {
  const cur = current.value
  if (!cur) return
  sampler.play(
    {
      startSec: Math.max(cur.startSec, cur.endSec - ROLL_SEC),
      endSec: cur.endSec,
      pitch: cur.pitch,
    },
    activePad.value,
  )
}

const lengthSec = computed(() =>
  current.value ? current.value.endSec - current.value.startSec : 0,
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
              :markers="[]"
              :range-start="total > 0 ? view.start / total : 0"
              :range-end="total > 0 ? view.end / total : 1"
              :dense="zoomed"
            />
          </div>

          <!-- View toggle sits on the strip: it's about what you're looking
               at, and costs no vertical space there. -->
          <button
            v-if="canZoom"
            class="absolute top-1 right-1 z-10 px-2 h-6 rounded border text-[9px] tracking-wide"
            :class="zoomed
              ? 'border-flag bg-ink-900/80 text-flag'
              : 'border-ink-500 bg-ink-900/70 text-flag-soft'"
            @pointerdown.stop="zoomed = !zoomed"
          >
            {{ zoomed ? 'TRIM' : 'ALL' }}
          </button>

          <!-- Every assigned chop, so the whole layout is visible at once.
               v-if lives on an inner element: v-show would still evaluate the
               style bindings for empty pads, and v-if on the v-for element
               itself runs before the loop variable exists. -->
          <template v-for="(p, i) in bank" :key="i">
            <div
              v-if="p && inView(p.startSec, p.endSec)"
              class="absolute inset-y-0 pointer-events-none border-l"
              :class="[
                sampler.playing.value === i
                  ? 'bg-flag/45 border-cream'
                  : i === activePad
                    ? 'bg-flag/25 border-flag'
                    : 'bg-flag/10 border-flag/40',
              ]"
              :style="{ left: `${pct(p.startSec)}%`, width: `${pct(p.endSec - p.startSec)}%` }"
            >
              <span class="absolute top-0.5 left-1 text-[9px] tabular-nums text-cream/80">
                {{ i + 1 }}
              </span>
            </div>
          </template>

          <!-- Trim handles on the active chop. -->
          <template v-if="current">
            <div
              class="absolute inset-y-0 w-1 bg-cream pointer-events-none"
              :style="{ left: `${pct(current.startSec)}%` }"
            />
            <div
              class="absolute inset-y-0 w-1 bg-cream pointer-events-none"
              :style="{ left: `calc(${pct(current.endSec)}% - 4px)` }"
            />
          </template>

          <!-- Live playhead: what the cuts are made against. -->
          <div
            v-if="sampler.playing.value !== null || lazy"
            class="absolute inset-y-0 w-0.5 bg-cream pointer-events-none"
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
          <span>{{ current ? formatTime(current.startSec) : '—' }}</span>
          <span class="text-flag">
            Pad {{ activePad + 1 }} · {{ lengthSec.toFixed(2) }}s
          </span>
          <span>{{ current ? formatTime(current.endSec) : '—' }}</span>
        </div>

        <!-- Trim -->
        <div v-if="!lazy" class="flex items-center gap-1.5 mt-2">
          <span class="text-[10px] text-ink-500 w-4">IN</span>
          <button class="trim" :disabled="!current" @click="nudge('startSec', -0.1)">−</button>
          <button class="trim" :disabled="!current" @click="nudge('startSec', 0.1)">+</button>
          <span class="flex-1" />
          <button class="trim" :disabled="!current" @click="nudge('endSec', -0.1)">−</button>
          <button class="trim" :disabled="!current" @click="nudge('endSec', 0.1)">+</button>
          <span class="text-[10px] text-ink-500 w-6 text-right">OUT</span>
        </div>

        <div v-if="!lazy" class="flex items-center gap-2 mt-2">
          <button
            class="flex-1 h-10 rounded-lg bg-ink-600 text-cream text-[13px]
                   active:bg-ink-500 disabled:opacity-40"
            :disabled="!current"
            @click="current && sampler.play(current, activePad)"
          >
            Play
          </button>
          <!-- The tail of the trim, for hearing where the out point lands. -->
          <button
            class="flex-1 h-10 rounded-lg border border-ink-500 text-flag-soft text-[13px]
                   active:bg-ink-700 disabled:opacity-40"
            :disabled="!current"
            @click="roll"
          >
            Roll
          </button>
          <button
            class="px-3 h-10 rounded-lg border text-[11px] tracking-wide active:bg-ink-700
                   disabled:opacity-40"
            :class="lazy ? 'border-flag text-flag' : 'border-ink-500 text-flag-soft'"
            :disabled="!current"
            title="Play the trim and cut on the fly"
            @click="startLazyChop"
          >
            CHOP
          </button>
        </div>

        <!-- Pitch: varispeed, so it shifts length too. -->
        <div v-if="!lazy" class="flex items-center gap-2 mt-2">
          <span class="text-[10px] text-ink-500 w-9">PITCH</span>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            :value="current?.pitch ?? 0"
            :disabled="!current"
            class="flex-1 accent-[#d99a4e] disabled:opacity-40"
            aria-label="Pitch in semitones"
            @input="setPitch(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="w-8 text-right text-[12px] tabular-nums text-flag">
            {{ (current?.pitch ?? 0) > 0 ? '+' : '' }}{{ current?.pitch ?? 0 }}
          </span>
        </div>
      </div>

      <!-- Pads: square, so the controls above keep their room. -->
      <div class="flex-1 min-h-0 px-4 pt-3 pb-safe overflow-y-auto">
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

        <p class="text-center text-[10px] text-ink-500 mt-3 leading-relaxed">
          Tap a pad, then drag the waveform to chop it. Drag an edge to trim.
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
