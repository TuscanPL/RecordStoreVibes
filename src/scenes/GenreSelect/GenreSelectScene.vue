<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '../../stores/app'
import { GENRES } from '../../providers/types'
import { useProvider } from '../../composables/useProvider'

const store = useAppStore()
const { loadCrate, error } = useProvider()
const isEntering = ref(false)

async function handleGenreSelect(genreId: string) {
  if (isEntering.value) return
  isEntering.value = true

  store.selectGenre(genreId)
  await loadCrate(genreId)

  isEntering.value = false
}
</script>

<template>
  <div class="absolute inset-0 flex flex-col items-center justify-center z-10">
    <!-- Grain overlay -->
    <div class="absolute inset-0 pointer-events-none opacity-[0.03] bg-noise" />

    <!-- Header -->
    <div class="text-center mb-12">
      <h1 class="font-display text-6xl md:text-7xl font-bold text-vinyl-cream tracking-tight">
        Spinback
      </h1>
      <p class="font-display text-lg text-vinyl-amber/70 mt-2 italic">
        Record Store Vibes
      </p>
    </div>

    <!-- Genre prompt -->
    <p class="text-vinyl-cream/60 text-sm uppercase tracking-[0.2em] mb-8 font-body">
      What are you digging for today?
    </p>

    <!-- Genre grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl px-6">
      <button
        v-for="genre in GENRES"
        :key="genre.id"
        class="group relative px-6 py-4 rounded-lg border border-vinyl-amber/20
               bg-vinyl-warm/60 hover:bg-vinyl-brown/80 hover:border-vinyl-amber/40
               transition-all duration-300 active:scale-[0.97]"
        :disabled="isEntering"
        @pointerdown="handleGenreSelect(genre.id)"
      >
        <span class="text-2xl block mb-1">{{ genre.icon }}</span>
        <span class="text-sm font-display text-vinyl-cream group-hover:text-vinyl-amber transition-colors">
          {{ genre.label }}
        </span>
      </button>
    </div>

    <!-- Error message -->
    <p v-if="error" class="mt-6 text-red-400/80 text-sm">{{ error }}</p>

    <!-- Loading state -->
    <div v-if="isEntering" class="mt-8 flex items-center gap-3 text-vinyl-amber/60">
      <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      <span class="text-sm italic font-body">Walking into the store...</span>
    </div>

    <!-- Footer -->
    <div class="absolute bottom-6 text-center">
      <p class="text-[10px] text-vinyl-amber/30 font-body">
        Public domain music from the Internet Archive
      </p>
    </div>
  </div>
</template>

<style scoped>
.bg-noise {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}
</style>
