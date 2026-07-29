<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { provider } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { useAudio, formatTime } from '../composables/useAudio'

const props = defineProps<{ id: string }>()
const router = useRouter()
const library = useLibrary()
const audio = useAudio()

const record = ref<CrateRecord | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const trackIndex = ref(0)
const justFlagged = ref<string | null>(null)
const scrubbing = ref(false)
const scrubValue = ref(0)

const track = computed(() => record.value?.tracks[trackIndex.value] ?? null)
const starred = computed(() => (record.value ? library.isStarred(record.value.id) : false))

/** Markers on the track currently loaded, for the scrubber ticks. */
const trackMarkers = computed(() => {
  if (!record.value || !track.value) return []
  return library.markersFor(record.value.id, track.value.name)
})

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

  if (record.value?.tracks.length) void openTrack(0)
})

async function openTrack(index: number) {
  if (!record.value) return
  const t = record.value.tracks[index]
  if (!t) return
  trackIndex.value = index
  await audio.load(record.value, t, true)
}

function onScrubStart() {
  scrubbing.value = true
  scrubValue.value = audio.position.value
}

function onScrubInput(e: Event) {
  scrubValue.value = Number((e.target as HTMLInputElement).value)
}

function onScrubEnd() {
  audio.seek(scrubValue.value)
  scrubbing.value = false
}

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
    </header>

    <p v-if="error" class="px-6 py-10 text-center text-[14px] text-red-300/80">{{ error }}</p>
    <p v-else-if="loading" class="px-6 py-10 text-center text-[13px] text-flag-dim">Loading…</p>

    <template v-else-if="record">
      <!-- Upper area: look, don't touch. -->
      <div class="flex-1 min-h-0 flex flex-col items-center justify-center px-6 gap-4">
        <div
          class="w-full max-w-[min(58vw,300px)] aspect-square rounded-lg overflow-hidden
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

        <p v-if="trackMarkers.length" class="text-[11px] text-flag">
          {{ trackMarkers.length }} flagged on this track
        </p>
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
        <div class="relative h-6 flex items-center">
          <div class="absolute inset-x-0 h-1.5 rounded-full bg-ink-600" />
          <div
            class="absolute left-0 h-1.5 rounded-full bg-flag-dim"
            :style="{ width: `${pct}%` }"
          />
          <!-- Flagged spots, so you can see what you've already caught. -->
          <div
            v-for="m in trackMarkers"
            :key="m.id"
            class="absolute w-0.5 h-3.5 bg-flag rounded-full pointer-events-none"
            :style="{ left: `${total > 0 ? (m.timestampSec / total) * 100 : 0}%` }"
          />
          <input
            type="range"
            min="0"
            :max="total || 1"
            step="0.5"
            :value="displayPos"
            class="scrub absolute inset-x-0 w-full appearance-none bg-transparent"
            :disabled="!isCurrent || total === 0"
            aria-label="Seek"
            @pointerdown="onScrubStart"
            @input="onScrubInput"
            @change="onScrubEnd"
            @pointerup="onScrubEnd"
          />
        </div>

        <div class="flex justify-between text-[11px] text-flag-dim tabular-nums mt-1">
          <span>{{ formatTime(displayPos) }}</span>
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
/* Invisible native range on top of the drawn track — native touch dragging
   without fighting the browser's own thumb rendering. */
.scrub {
  height: 24px;
}
.scrub::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: #f2ece0;
  border: 2px solid #0e0c0a;
}
.scrub::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: #f2ece0;
  border: 2px solid #0e0c0a;
}
.scrub:disabled::-webkit-slider-thumb {
  background: #3d342b;
}
</style>
