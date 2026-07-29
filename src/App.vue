<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useLibrary } from './stores/library'
import { useAudio } from './composables/useAudio'
import NowPlaying from './components/NowPlaying.vue'

const route = useRoute()
const library = useLibrary()
const audio = useAudio()

// The player is a pushed detail view — it owns the whole screen, and the
// now-playing strip would just be a link back to where you already are.
const showTabs = computed(() => route.name !== 'player')

/**
 * Whether the strip carries over out of the player.
 *
 * Decided at the moment you leave, not bound to isPlaying continuously —
 * otherwise pausing from the strip would make it vanish under your thumb
 * and leave you no way back to the track.
 */
const carry = ref(false)

watch(
  () => route.name,
  (to, from) => {
    if (from === 'player' && to !== 'player') carry.value = audio.isPlaying.value
  },
)

// Starting playback anywhere — including the lock screen — brings it back.
watch(
  () => audio.isPlaying.value,
  playing => {
    if (playing) carry.value = true
  },
)
</script>

<template>
  <div class="h-full flex flex-col bg-ink-900">
    <router-view class="flex-1 min-h-0" />

    <NowPlaying v-if="showTabs && carry" />

    <nav
      v-if="showTabs"
      class="flex-none border-t border-ink-600 bg-ink-800 pb-safe"
    >
      <div class="flex">
        <router-link
          to="/"
          class="flex-1 flex flex-col items-center gap-1 py-3 text-[11px] tracking-wide"
          :class="route.name === 'browse' ? 'text-flag' : 'text-flag-dim'"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" stroke-linecap="round" />
          </svg>
          BROWSE
        </router-link>

        <router-link
          to="/flagged"
          class="flex-1 flex flex-col items-center gap-1 py-3 text-[11px] tracking-wide relative"
          :class="route.name === 'flagged' ? 'text-flag' : 'text-flag-dim'"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
            <path d="M5 21V4.5a.5.5 0 01.3-.46C6.5 3.5 8 3 10 3c3 0 4.5 2 7.5 2 .8 0 1.4-.1 1.9-.24a.4.4 0 01.6.36v8.2a.5.5 0 01-.3.46c-.6.26-1.3.46-2.2.46-3 0-4.5-2-7.5-2-1.6 0-2.9.36-4 .8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          FLAGGED
          <span
            v-if="library.markerCount > 0"
            class="absolute top-1.5 right-[calc(50%-1.65rem)] min-w-[18px] h-[18px] px-1
                   rounded-full bg-flag text-ink-900 text-[10px] font-semibold
                   flex items-center justify-center tabular-nums"
          >
            {{ library.markerCount }}
          </span>
        </router-link>
      </div>
    </nav>
  </div>
</template>
