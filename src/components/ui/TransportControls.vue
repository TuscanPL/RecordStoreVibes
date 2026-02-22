<script setup lang="ts">
import { useAppStore } from '../../stores/app'

const store = useAppStore()

const emit = defineEmits<{
  (e: 'toggle-play'): void
  (e: 'rewind'): void
  (e: 'fast-forward'): void
  (e: 'previous-track'): void
  (e: 'next-track'): void
  (e: 'flip-side'): void
  (e: 'toggle-rpm'): void
}>()
</script>

<template>
  <div class="bg-vinyl-warm/90 backdrop-blur-sm rounded-xl p-4 border border-vinyl-amber/20">
    <!-- Main transport -->
    <div class="flex items-center justify-center gap-4">
      <!-- Previous track -->
      <button
        class="transport-btn"
        title="Previous track"
        @pointerdown="emit('previous-track')"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
        </svg>
      </button>

      <!-- Rewind -->
      <button
        class="transport-btn"
        title="Rewind 5s"
        @pointerdown="emit('rewind')"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
        </svg>
      </button>

      <!-- Play / Pause -->
      <button
        class="w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200
               bg-vinyl-amber text-vinyl-warm hover:bg-vinyl-cream active:scale-95"
        title="Play / Pause"
        @pointerdown="emit('toggle-play')"
      >
        <!-- Pause icon -->
        <svg v-if="store.isPlaying" class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
        <!-- Play icon -->
        <svg v-else class="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </button>

      <!-- Fast forward -->
      <button
        class="transport-btn"
        title="Forward 5s"
        @pointerdown="emit('fast-forward')"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
        </svg>
      </button>

      <!-- Next track -->
      <button
        class="transport-btn"
        title="Next track"
        @pointerdown="emit('next-track')"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
        </svg>
      </button>
    </div>

    <!-- Secondary controls -->
    <div class="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-vinyl-amber/10">
      <!-- Flip side -->
      <button
        class="text-xs text-vinyl-amber/70 hover:text-vinyl-cream transition-colors flex items-center gap-1.5"
        @pointerdown="emit('flip-side')"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
        </svg>
        Side {{ store.currentSide }}
      </button>

      <!-- RPM toggle -->
      <button
        class="text-xs transition-colors flex items-center gap-1.5"
        :class="store.rpm === 45 ? 'text-vinyl-cream' : 'text-vinyl-amber/70 hover:text-vinyl-cream'"
        @pointerdown="emit('toggle-rpm')"
      >
        <span class="w-8 h-4 rounded-full border border-current relative inline-flex items-center">
          <span
            class="w-3 h-3 rounded-full bg-current absolute transition-all duration-200"
            :class="store.rpm === 45 ? 'left-4' : 'left-0.5'"
          />
        </span>
        {{ store.rpm === 33 ? '33⅓' : '45' }} RPM
      </button>
    </div>
  </div>
</template>

<style scoped>
.transport-btn {
  @apply w-10 h-10 rounded-full flex items-center justify-center
         text-vinyl-amber/70 hover:text-vinyl-cream hover:bg-vinyl-brown/50
         transition-all duration-200 active:scale-95;
}
</style>
