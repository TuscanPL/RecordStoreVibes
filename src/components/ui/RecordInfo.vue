<script setup lang="ts">
import type { Album } from '../../providers/types'

const props = defineProps<{
  album: Album
  side?: 'A' | 'B'
  trackIndex?: number
}>()
</script>

<template>
  <div class="bg-vinyl-warm/90 backdrop-blur-sm rounded-lg p-4 border border-vinyl-amber/20 max-w-sm">
    <!-- Album Art Thumbnail -->
    <div class="flex gap-4">
      <div class="w-20 h-20 rounded overflow-hidden flex-shrink-0 bg-vinyl-brown">
        <img
          v-if="album.coverArtUrl"
          :src="album.coverArtUrl"
          :alt="album.title"
          class="w-full h-full object-cover"
          crossorigin="anonymous"
          @error="($event.target as HTMLImageElement).style.display = 'none'"
        />
        <div v-else class="w-full h-full flex items-center justify-center text-vinyl-amber text-2xl">
          ♫
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <h3 class="font-display font-bold text-vinyl-cream text-sm leading-tight truncate">
          {{ album.title }}
        </h3>
        <p class="text-vinyl-amber text-xs mt-1 truncate">{{ album.artist }}</p>
        <p v-if="album.year" class="text-vinyl-amber/60 text-xs mt-0.5">{{ album.year }}</p>

        <div v-if="side" class="mt-2 flex items-center gap-2">
          <span class="text-[10px] uppercase tracking-wider text-vinyl-amber/80 bg-vinyl-brown/50 px-2 py-0.5 rounded">
            Side {{ side }}
          </span>
          <span v-if="trackIndex !== undefined" class="text-[10px] text-vinyl-amber/60">
            Track {{ trackIndex + 1 }}
          </span>
        </div>
      </div>
    </div>

    <!-- Track listing for current side -->
    <div v-if="side && album.sides[side].tracks.length > 1" class="mt-3 border-t border-vinyl-amber/10 pt-2">
      <div
        v-for="(track, i) in album.sides[side].tracks"
        :key="track.id"
        class="flex items-center gap-2 py-0.5 text-xs"
        :class="i === trackIndex ? 'text-vinyl-cream' : 'text-vinyl-amber/50'"
      >
        <span class="w-4 text-right tabular-nums">{{ i + 1 }}.</span>
        <span class="truncate flex-1">{{ track.title }}</span>
        <span v-if="track.duration" class="tabular-nums text-[10px]">
          {{ Math.floor(track.duration / 60) }}:{{ String(Math.floor(track.duration % 60)).padStart(2, '0') }}
        </span>
      </div>
    </div>

    <!-- Source attribution -->
    <div class="mt-2 pt-2 border-t border-vinyl-amber/10">
      <a
        :href="album.sourceUrl"
        target="_blank"
        rel="noopener"
        class="text-[10px] text-vinyl-amber/40 hover:text-vinyl-amber/70 transition-colors"
      >
        Source: {{ album.provider }}
      </a>
    </div>
  </div>
</template>
