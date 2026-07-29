<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { provider } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { PAD_COUNT, padKey, type Pad } from '../stores/storage'
import { useSampler } from '../composables/useSampler'
import { formatTime } from '../composables/useAudio'
import Waveform from '../components/Waveform.vue'

const props = defineProps<{ id: string; track: string }>()
const router = useRouter()
const library = useLibrary()
const sampler = useSampler()

const record = ref<CrateRecord | null>(null)
const loadError = ref<string | null>(null)

/** Working sample. Edited by the trim and pitch controls. */
const sel = ref<Pad>({ startSec: 0, endSec: 2, pitch: 0 })
const activePad = ref<number | null>(null)

const trackName = computed(() => decodeURIComponent(props.track))
const key = computed(() => padKey(props.id, trackName.value))
const bank = computed(() => library.padsFor(key.value))
const total = computed(() => sampler.buffer.value?.duration ?? 0)

const trackMeta = computed(
  () => record.value?.tracks.find(t => t.name === trackName.value) ?? null,
)

/** Shown so a resampled decode is never a silent downgrade. */
const degraded = computed(
  () => sampler.rate.value > 0 && sampler.rate.value < 44100,
)

onMounted(async () => {
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
    if (sampler.buffer.value) {
      sel.value = { startSec: 0, endSec: Math.min(2, sampler.buffer.value.duration), pitch: 0 }
    }
  } catch {
    loadError.value = "Couldn't open the sampler for this track."
  }
})

// The decoded buffer is the largest thing the app holds — never leave it behind.
onBeforeUnmount(() => sampler.release())

/* ---- selecting a region on the waveform ---- */

const strip = ref<HTMLElement | null>(null)
let dragFrom: number | null = null

function timeAt(e: PointerEvent): number {
  const el = strip.value
  if (!el || total.value <= 0) return 0
  const r = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * total.value
}

function onDown(e: PointerEvent) {
  if (!sampler.buffer.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragFrom = timeAt(e)
  sel.value = { ...sel.value, startSec: dragFrom, endSec: dragFrom + 0.05 }
}

function onMove(e: PointerEvent) {
  if (dragFrom === null) return
  const t = timeAt(e)
  sel.value = {
    ...sel.value,
    startSec: Math.min(dragFrom, t),
    endSec: Math.max(dragFrom + 0.05, Math.max(dragFrom, t)),
  }
}

function onUp(e: PointerEvent) {
  if (dragFrom === null) return
  dragFrom = null
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    // capture already gone
  }
  writeThrough()
  preview()
}

/** Nudge either edge. Coarse on a phone is fine; the ear does the rest. */
function nudge(edge: 'startSec' | 'endSec', delta: number) {
  const next = { ...sel.value }
  next[edge] = Math.max(0, Math.min(total.value, next[edge] + delta))
  if (next.endSec - next.startSec < 0.05) return
  sel.value = next
  writeThrough()
}

function setPitch(semitones: number) {
  sel.value = { ...sel.value, pitch: Math.max(-12, Math.min(12, semitones)) }
  writeThrough()
}

/** Edits land on the selected pad live, so there's no separate save step. */
function writeThrough() {
  if (activePad.value !== null && bank.value[activePad.value]) {
    library.setPad(key.value, activePad.value, { ...sel.value })
  }
}

function preview() {
  sampler.play(sel.value, activePad.value)
}

/* ---- pads ---- */

function hitPad(i: number) {
  const existing = bank.value[i]
  if (existing) {
    activePad.value = i
    sel.value = { ...existing }
    sampler.play(existing, i)
  } else {
    // Empty pad takes whatever's currently trimmed.
    const pad = { ...sel.value }
    library.setPad(key.value, i, pad)
    activePad.value = i
    sampler.play(pad, i)
  }
}

function clearPad(i: number) {
  library.setPad(key.value, i, null)
  if (activePad.value === i) activePad.value = null
}

const selPercents = computed(() => {
  if (total.value <= 0) return { left: 0, width: 0 }
  return {
    left: (sel.value.startSec / total.value) * 100,
    width: ((sel.value.endSec - sel.value.startSec) / total.value) * 100,
  }
})

const lengthSec = computed(() => sel.value.endSec - sel.value.startSec)
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
      <p class="text-[11px] text-ink-500 text-center">
        The whole track has to come down before it can be chopped.
      </p>
    </div>

    <template v-else-if="sampler.buffer.value">
      <!-- Trim -->
      <div class="flex-none px-4 pt-2">
        <div
          ref="strip"
          class="sel relative h-20 rounded overflow-hidden bg-ink-800"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        >
          <div class="absolute inset-0">
            <Waveform :peaks="sampler.peaks.value" :progress="0" :markers="[]" />
          </div>
          <!-- Selected region, drawn over the waveform. -->
          <div
            class="absolute inset-y-0 bg-flag/25 border-x-2 border-flag pointer-events-none"
            :style="{ left: `${selPercents.left}%`, width: `${selPercents.width}%` }"
          />
        </div>

        <div class="flex items-center justify-between mt-1 text-[11px] tabular-nums text-flag-dim">
          <span>{{ formatTime(sel.startSec) }}</span>
          <span class="text-flag">{{ lengthSec.toFixed(2) }}s</span>
          <span>{{ formatTime(sel.endSec) }}</span>
        </div>

        <div class="flex items-center gap-2 mt-2">
          <div class="flex-1 flex items-center gap-1">
            <span class="text-[10px] text-ink-500 w-5">IN</span>
            <button class="trim" @click="nudge('startSec', -0.25)">−</button>
            <button class="trim" @click="nudge('startSec', 0.25)">+</button>
          </div>
          <button
            class="px-4 h-10 rounded-lg bg-ink-600 text-cream text-[13px] active:bg-ink-500"
            @click="preview"
          >
            Preview
          </button>
          <div class="flex-1 flex items-center justify-end gap-1">
            <button class="trim" @click="nudge('endSec', -0.25)">−</button>
            <button class="trim" @click="nudge('endSec', 0.25)">+</button>
            <span class="text-[10px] text-ink-500 w-6 text-right">OUT</span>
          </div>
        </div>

        <!-- Pitch: varispeed, so it shifts length too. -->
        <div class="flex items-center gap-2 mt-2">
          <span class="text-[10px] text-ink-500 w-10">PITCH</span>
          <button class="trim" @click="setPitch(sel.pitch - 1)">−</button>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            :value="sel.pitch"
            class="flex-1 accent-[#d99a4e]"
            aria-label="Pitch in semitones"
            @input="setPitch(Number(($event.target as HTMLInputElement).value))"
          />
          <button class="trim" @click="setPitch(sel.pitch + 1)">+</button>
          <span class="w-10 text-right text-[12px] tabular-nums text-flag">
            {{ sel.pitch > 0 ? '+' : '' }}{{ sel.pitch }}
          </span>
        </div>
      </div>

      <!-- Pads -->
      <div class="flex-1 min-h-0 px-4 pt-3 pb-safe">
        <div class="grid grid-cols-4 gap-2 h-full">
          <button
            v-for="i in PAD_COUNT"
            :key="i - 1"
            class="relative rounded-lg border text-[11px] tabular-nums transition-colors"
            :class="[
              bank[i - 1]
                ? 'border-flag bg-flag/15 text-flag'
                : 'border-ink-600 bg-ink-800 text-ink-500',
              activePad === i - 1 ? 'ring-2 ring-flag' : '',
              sampler.playing.value === i - 1 ? 'bg-flag text-ink-900' : '',
            ]"
            @pointerdown="hitPad(i - 1)"
          >
            <span class="absolute top-1 left-1.5 text-[9px] opacity-60">{{ i }}</span>
            <span v-if="bank[i - 1]">
              {{ (bank[i - 1]!.endSec - bank[i - 1]!.startSec).toFixed(1) }}s
              <span v-if="bank[i - 1]!.pitch" class="block text-[9px]">
                {{ bank[i - 1]!.pitch > 0 ? '+' : '' }}{{ bank[i - 1]!.pitch }}
              </span>
            </span>
            <span
              v-if="bank[i - 1]"
              class="absolute top-0 right-0 w-6 h-6 flex items-center justify-center text-ink-500"
              role="button"
              aria-label="Clear pad"
              @pointerdown.stop="clearPad(i - 1)"
            >
              ×
            </span>
          </button>
        </div>

        <p v-if="degraded" class="text-center text-[10px] text-ink-500 mt-2">
          Decoded at {{ (sampler.rate.value / 1000).toFixed(1) }}kHz to fit in memory —
          fine for judging, cut the real one from the download.
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
         active:bg-ink-600 flex-none;
}
</style>
