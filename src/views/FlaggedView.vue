<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLibrary } from '../stores/library'
import { useAudio, formatTime } from '../composables/useAudio'
import { useExport } from '../composables/useExport'

const library = useLibrary()
const audio = useAudio()
const { exportJson, exportCsv, trackUrl } = useExport()

const expanded = ref<string | null>(null)
const showStarred = ref(false)

const groups = computed(() => library.flagged)
const hasAnything = computed(() => groups.value.length > 0)

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
}

/** Distinct files touched, since the manifest is consumed per-file. */
function fileCount(markers: { trackName: string }[]): number {
  return new Set(markers.map(m => m.trackName)).size
}
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex-none px-4 pt-safe pb-2 flex items-baseline justify-between">
      <h1 class="font-display text-2xl text-cream">Flagged</h1>
      <p class="text-[11px] text-flag-dim tabular-nums">
        {{ library.markerCount }} marker{{ library.markerCount === 1 ? '' : 's' }}
      </p>
    </header>

    <div class="flex-1 min-h-0 scroll-y">
      <p
        v-if="library.persistFailed"
        class="mx-4 mb-2 px-3 py-2 rounded bg-red-950/50 border border-red-900/60
               text-[12px] text-red-200/90"
      >
        Markers can't be saved on this device — private browsing blocks storage.
        Export before you close the tab.
      </p>

      <p
        v-if="!hasAnything"
        class="px-8 py-16 text-center text-[14px] text-flag-dim leading-relaxed"
      >
        Nothing flagged yet.
        <br />
        <span class="text-[13px] text-ink-500">
          Play something and hit the big button when you hear a bar worth keeping.
        </span>
      </p>

      <div v-for="g in groups" :key="g.record.id" class="border-b border-ink-700/60">
        <button
          class="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-ink-700"
          @click="toggle(g.record.id)"
        >
          <div class="w-12 h-12 flex-none rounded bg-ink-700 overflow-hidden">
            <img
              v-if="g.record.artworkUrl"
              :src="g.record.artworkUrl"
              alt=""
              loading="lazy"
              class="w-full h-full object-cover"
              @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-[14px] text-cream line-clamp-2 leading-tight">{{ g.record.title }}</p>
            <p class="text-[12px] text-flag mt-0.5">
              {{ g.markers.length }} marker{{ g.markers.length === 1 ? '' : 's' }}
              <span class="text-flag-dim">
                · {{ fileCount(g.markers) }} file{{ fileCount(g.markers) === 1 ? '' : 's' }}
              </span>
            </p>
          </div>
          <svg
            class="w-5 h-5 flex-none text-ink-500 transition-transform"
            :class="expanded === g.record.id ? 'rotate-180' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <div v-if="expanded === g.record.id" class="pb-3 bg-ink-800/60">
          <div
            v-for="m in g.markers"
            :key="m.id"
            class="flex items-center gap-2 px-4 py-2 border-t border-ink-700/40"
          >
            <span class="w-14 flex-none text-[13px] text-flag tabular-nums">
              {{ formatTime(m.timestampSec) }}
            </span>
            <input
              :value="m.note ?? ''"
              placeholder="note…"
              class="flex-1 min-w-0 h-9 px-2 rounded bg-ink-700 text-[13px] text-cream
                     placeholder:text-ink-500 border border-ink-600
                     focus:outline-none focus:border-flag-dim"
              @change="library.setNote(m.id, ($event.target as HTMLInputElement).value)"
            />
            <button
              class="w-9 h-9 flex-none flex items-center justify-center text-ink-500 active:text-red-300"
              aria-label="Delete marker"
              @click="library.removeMarker(m.id)"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <div class="flex flex-wrap gap-2 px-4 pt-3">
            <router-link
              :to="`/r/${g.record.id}`"
              class="px-3 h-9 inline-flex items-center rounded-full border border-ink-500
                     text-[12px] text-flag-soft active:bg-ink-700"
            >
              Open
            </router-link>
            <a
              v-for="name in [...new Set(g.markers.map(m => m.trackName))]"
              :key="name"
              :href="trackUrl(g.record.id, name)"
              download
              class="px-3 h-9 inline-flex items-center rounded-full border border-ink-500
                     text-[12px] text-flag-soft active:bg-ink-700 max-w-[60vw] truncate"
            >
              ↓ {{ name }}
            </a>
            <a
              :href="g.record.sourceUrl"
              target="_blank"
              rel="noopener"
              class="px-3 h-9 inline-flex items-center rounded-full border border-ink-500
                     text-[12px] text-ink-500 active:bg-ink-700"
            >
              archive.org
            </a>
          </div>
        </div>
      </div>

      <!-- Starred lives here too, rather than earning a fourth screen. -->
      <div v-if="library.starredRecords.length" class="mt-2">
        <button
          class="w-full flex items-center justify-between px-4 py-3 text-left"
          @click="showStarred = !showStarred"
        >
          <span class="text-[12px] uppercase tracking-wider text-flag-dim">
            Starred · {{ library.starredRecords.length }}
          </span>
          <svg
            class="w-5 h-5 text-ink-500 transition-transform"
            :class="showStarred ? 'rotate-180' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <template v-if="showStarred">
          <router-link
            v-for="r in library.starredRecords"
            :key="r.id"
            :to="`/r/${r.id}`"
            class="flex items-center gap-3 px-4 py-2.5 active:bg-ink-700 border-t border-ink-700/40"
          >
            <div class="w-10 h-10 flex-none rounded bg-ink-700 overflow-hidden">
              <img
                v-if="r.artworkUrl" :src="r.artworkUrl" alt="" loading="lazy"
                class="w-full h-full object-cover"
                @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[13px] text-cream truncate">{{ r.title }}</p>
              <p class="text-[11px] text-flag-dim truncate">{{ r.creator }}</p>
            </div>
          </router-link>
        </template>
      </div>

      <div class="h-4" />
    </div>

    <!-- Now playing strip, so leaving the player doesn't lose your place. -->
    <router-link
      v-if="audio.currentRecord.value && audio.currentTrack.value"
      :to="`/r/${audio.currentRecord.value.id}`"
      class="flex-none flex items-center gap-3 px-4 py-2 bg-ink-700 border-t border-ink-600"
    >
      <span class="w-2 h-2 rounded-full flex-none" :class="audio.isPlaying.value ? 'bg-flag' : 'bg-ink-500'" />
      <p class="flex-1 min-w-0 text-[12px] text-cream truncate">
        {{ audio.currentTrack.value.title }}
      </p>
      <span class="text-[11px] text-flag-dim tabular-nums flex-none">
        {{ formatTime(audio.position.value) }}
      </span>
    </router-link>

    <div
      v-if="hasAnything"
      class="flex-none flex gap-2 px-3 py-2.5 border-t border-ink-700 bg-ink-800"
    >
      <button
        class="flex-1 h-12 rounded-lg bg-flag text-ink-900 text-[14px] font-semibold active:scale-[0.98] transition-transform"
        @click="exportJson(groups)"
      >
        Export JSON
      </button>
      <button
        class="flex-1 h-12 rounded-lg border border-ink-500 text-flag-soft text-[14px] active:bg-ink-700"
        @click="exportCsv(groups)"
      >
        CSV
      </button>
    </div>
  </div>
</template>
