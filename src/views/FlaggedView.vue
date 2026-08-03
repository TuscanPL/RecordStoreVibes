<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useLibrary } from '../stores/library'
import { downloadUrl, sourceLabel } from '../providers'
import { formatTime } from '../composables/useAudio'
import { useExport } from '../composables/useExport'
import { downloadedBytes, clearDownloads } from '../composables/useSampler'
import { formatBytes } from '../composables/useWaveform'

const library = useLibrary()
const { exportJson, exportCsv } = useExport()

const expanded = ref<string | null>(null)
const showStarred = ref(false)
const showChopped = ref(false)
const held = ref(0)

async function refreshHeld() {
  held.value = await downloadedBytes()
}
onMounted(refreshHeld)

async function wipeDownloads() {
  await clearDownloads()
  await refreshHeld()
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
            <!-- Provenance travels with the flag, so it's never a guess
                 where a sample came from. -->
            <p class="mt-1">
              <span
                class="inline-block px-1.5 py-0.5 rounded text-[10px] tracking-wide
                       bg-ink-700 text-flag-dim"
              >
                {{ sourceLabel(g.record) }}
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
            <!-- Only where there's something to download to. A file off
                 your own device has no address to hand out. -->
            <a
              v-for="name in [...new Set(g.markers.map(m => m.trackName))]
                .filter(n => downloadUrl(g.record, n))"
              :key="name"
              :href="downloadUrl(g.record, name)!"
              download
              target="_blank"
              rel="noopener"
              class="px-3 h-9 inline-flex items-center rounded-full border border-ink-500
                     text-[12px] text-flag-soft active:bg-ink-700 max-w-[60vw] truncate"
            >
              ↓ {{ name }}
            </a>
            <!-- A link when there's a page behind it, a plain tag when the
                 source is a file on this device. -->
            <a
              v-if="g.record.sourceUrl"
              :href="g.record.sourceUrl"
              target="_blank"
              rel="noopener"
              class="px-3 h-9 inline-flex items-center rounded-full border border-ink-500
                     text-[12px] text-ink-500 active:bg-ink-700"
            >
              {{ sourceLabel(g.record) }}
            </a>
            <span
              v-else
              class="px-3 h-9 inline-flex items-center rounded-full border border-ink-600
                     text-[12px] text-ink-500"
            >
              {{ sourceLabel(g.record) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Tracks with pads on them, so chopped work is findable again. -->
      <div v-if="library.chopped.length" class="mt-2">
        <button
          class="w-full flex items-center justify-between px-4 py-3 text-left"
          @click="showChopped = !showChopped"
        >
          <span class="text-[12px] uppercase tracking-wider text-flag-dim">
            Chopped · {{ library.chopped.length }}
          </span>
          <svg
            class="w-5 h-5 text-ink-500 transition-transform"
            :class="showChopped ? 'rotate-180' : ''"
            fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <template v-if="showChopped">
          <router-link
            v-for="c in library.chopped"
            :key="c.key"
            :to="`/r/${c.recordId}/pads/${encodeURIComponent(c.trackName)}`"
            class="flex items-center gap-3 px-4 py-2.5 active:bg-ink-700 border-t border-ink-700/40"
          >
            <div class="w-10 h-10 flex-none rounded bg-ink-700 overflow-hidden">
              <img
                v-if="c.record.artworkUrl" :src="c.record.artworkUrl" alt="" loading="lazy"
                class="w-full h-full object-cover"
                @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-[13px] text-cream truncate">{{ c.record.title }}</p>
              <p class="text-[11px] text-flag-dim truncate">
                {{ c.trackName }} · {{ sourceLabel(c.record) }}
              </p>
            </div>
            <span class="text-[11px] text-flag tabular-nums flex-none">
              {{ c.count }} pad{{ c.count === 1 ? '' : 's' }}
            </span>
          </router-link>
        </template>
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

      <!-- What's playable with no network, and a way to reclaim the space. -->
      <div
        v-if="held > 0"
        class="flex items-center gap-3 px-4 py-3 mt-2 border-t border-ink-700/40"
      >
        <div class="flex-1 min-w-0">
          <p class="text-[12px] uppercase tracking-wider text-flag-dim">Downloads</p>
          <p class="text-[11px] text-ink-500">
            {{ formatBytes(held) }} kept for offline chopping
          </p>
        </div>
        <button
          class="px-3 h-9 rounded-full border border-ink-500 text-[12px] text-flag-soft
                 active:bg-ink-700"
          @click="wipeDownloads"
        >
          Clear
        </button>
      </div>

      <div class="h-4" />
    </div>

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
