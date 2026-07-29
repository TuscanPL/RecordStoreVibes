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
/** Waiting for a tap to say where auto-chopping should begin. */
const arming = ref(false)

const trackName = computed(() => decodeURIComponent(props.track))
const key = computed(() => padKey(props.id, trackName.value))
const bank = computed(() => library.padsFor(key.value))
const total = computed(() => sampler.buffer.value?.duration ?? 0)
const current = computed<Pad | null>(() => bank.value[activePad.value] ?? null)

const trackMeta = computed(
  () => record.value?.tracks.find(t => t.name === trackName.value) ?? null,
)

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

function timeAt(e: PointerEvent): number {
  const el = strip.value
  if (!el || total.value <= 0) return 0
  const r = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * total.value
}

function pxPerSec(): number {
  const el = strip.value
  if (!el || total.value <= 0) return 1
  return el.getBoundingClientRect().width / total.value
}

function writePad(pad: Pad) {
  library.setPad(key.value, activePad.value, pad)
}

function onDown(e: PointerEvent) {
  if (!sampler.buffer.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  const t = timeAt(e)

  if (arming.value) {
    lazyChopFrom(t)
    arming.value = false
    return
  }

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
  const existing = bank.value[i]
  activePad.value = i
  if (existing) sampler.play(existing, i)
}

function clearPad(i: number) {
  library.setPad(key.value, i, null)
}

/**
 * Lazy chop: fill every pad with back-to-back slices from a point you pick.
 * Slice length is whatever the current chop is, so the grid is yours to set.
 */
function lazyChopFrom(start: number) {
  const len = current.value
    ? Math.max(0.1, current.value.endSec - current.value.startSec)
    : 1
  for (let i = 0; i < PAD_COUNT; i++) {
    const s = start + i * len
    if (s >= total.value) {
      library.setPad(key.value, i, null)
      continue
    }
    library.setPad(key.value, i, {
      startSec: s,
      endSec: Math.min(total.value, s + len),
      pitch: 0,
    })
  }
  activePad.value = 0
  if (bank.value[0]) sampler.play(bank.value[0]!, 0)
}

function pct(sec: number): number {
  return total.value > 0 ? (sec / total.value) * 100 : 0
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
          :class="arming ? 'ring-2 ring-flag' : ''"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="absolute inset-0">
            <Waveform :peaks="sampler.peaks.value" :progress="0" :markers="[]" />
          </div>

          <!-- Every assigned chop, so the whole layout is visible at once.
               v-if lives on an inner element: v-show would still evaluate the
               style bindings for empty pads, and v-if on the v-for element
               itself runs before the loop variable exists. -->
          <template v-for="(p, i) in bank" :key="i">
            <div
              v-if="p"
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

          <p
            v-if="arming"
            class="absolute inset-0 flex items-center justify-center text-[12px]
                   text-cream bg-ink-900/70 pointer-events-none"
          >
            Tap where chopping should start
          </p>
        </div>

        <div class="flex items-center justify-between mt-1 text-[11px] tabular-nums text-flag-dim">
          <span>{{ current ? formatTime(current.startSec) : '—' }}</span>
          <span class="text-flag">
            Pad {{ activePad + 1 }} · {{ lengthSec.toFixed(2) }}s
          </span>
          <span>{{ current ? formatTime(current.endSec) : '—' }}</span>
        </div>

        <!-- Trim -->
        <div class="flex items-center gap-1.5 mt-2">
          <span class="text-[10px] text-ink-500 w-4">IN</span>
          <button class="trim" :disabled="!current" @click="nudge('startSec', -0.1)">−</button>
          <button class="trim" :disabled="!current" @click="nudge('startSec', 0.1)">+</button>
          <button
            class="flex-1 h-9 rounded-lg bg-ink-600 text-cream text-[12px] active:bg-ink-500
                   disabled:opacity-40"
            :disabled="!current"
            @click="current && sampler.play(current, activePad)"
          >
            Preview
          </button>
          <button class="trim" :disabled="!current" @click="nudge('endSec', -0.1)">−</button>
          <button class="trim" :disabled="!current" @click="nudge('endSec', 0.1)">+</button>
          <span class="text-[10px] text-ink-500 w-6 text-right">OUT</span>
        </div>

        <!-- Pitch: varispeed, so it shifts length too. -->
        <div class="flex items-center gap-2 mt-2">
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
          <button
            class="px-2.5 h-9 rounded-lg border text-[10px] tracking-wide active:bg-ink-700"
            :class="arming ? 'border-flag text-flag' : 'border-ink-500 text-flag-soft'"
            @click="arming = !arming"
          >
            CHOP
          </button>
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
