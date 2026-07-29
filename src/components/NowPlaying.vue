<script setup lang="ts">
import { computed } from 'vue'
import { useAudio, formatTime } from '../composables/useAudio'

const audio = useAudio()

const record = computed(() => audio.currentRecord.value)
const track = computed(() => audio.currentTrack.value)

const pct = computed(() => {
  const d = audio.effectiveDuration.value
  return d > 0 ? (audio.position.value / d) * 100 : 0
})

function onToggle(e: Event) {
  // The whole strip is a link back to the player; the button isn't.
  e.preventDefault()
  e.stopPropagation()
  void audio.toggle()
}
</script>

<template>
  <router-link
    v-if="record && track"
    :to="`/r/${record.id}`"
    class="flex-none block bg-ink-700 border-t border-ink-600 active:bg-ink-600"
  >
    <!-- Hairline progress, so the strip says how far in you are at a glance. -->
    <div class="h-0.5 bg-ink-600">
      <div class="h-full bg-flag-dim" :style="{ width: `${pct}%` }" />
    </div>

    <div class="flex items-center gap-3 px-3 py-2">
      <div class="w-9 h-9 flex-none rounded bg-ink-600 overflow-hidden">
        <img
          v-if="record.artworkUrl"
          :src="record.artworkUrl"
          alt=""
          class="w-full h-full object-cover"
          @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
        />
      </div>

      <div class="flex-1 min-w-0">
        <p class="text-[13px] text-cream truncate leading-tight">{{ track.title }}</p>
        <p class="text-[11px] text-flag-dim truncate">{{ record.creator }}</p>
      </div>

      <span class="text-[11px] text-flag-dim tabular-nums flex-none">
        {{ formatTime(audio.position.value) }}
      </span>

      <button
        class="w-10 h-10 flex-none flex items-center justify-center rounded-full
               text-cream active:bg-ink-500"
        :aria-label="audio.isPlaying.value ? 'Pause' : 'Play'"
        @click="onToggle"
      >
        <svg v-if="audio.isLoading.value" class="w-5 h-5 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 3a9 9 0 109 9" stroke-linecap="round" />
        </svg>
        <svg v-else-if="audio.isPlaying.value" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
        </svg>
        <svg v-else class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
    </div>
  </router-link>
</template>
