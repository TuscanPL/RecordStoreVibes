<script setup lang="ts">
import { computed } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { useAppStore } from '../../stores/app'
import { useTurntable } from '../../composables/useTurntable'
import TurntableModel from '../../components/3d/TurntableModel.vue'
import VinylRecord from '../../components/3d/VinylRecord.vue'
import Desk from '../../components/3d/Desk.vue'
import RecordInfo from '../../components/ui/RecordInfo.vue'
import TransportControls from '../../components/ui/TransportControls.vue'

const store = useAppStore()
const turntable = useTurntable()

const recordStackAlbums = computed(() => {
  return store.selectedRecords.filter(r => r.id !== store.activeRecord?.id)
})

function selectFromStack(album: typeof store.activeRecord) {
  if (!album) return
  turntable.placeRecord(album)
}

function handleBack() {
  turntable.audio.stop()
  store.currentScene = 'crate-browse'
}
</script>

<template>
  <div class="absolute inset-0">
    <!-- 3D Scene -->
    <TresCanvas :clear-color="'#0a0805'" :shadows="true">
      <!-- Camera -->
      <TresPerspectiveCamera :position="[0, 5, 6]" :look-at="[0, 0, 0]" />

      <!-- Lighting -->
      <TresAmbientLight :intensity="0.2" color="#ffe4c4" />
      <TresDirectionalLight :position="[2, 4, 3]" :intensity="0.6" color="#ffd4a0" :cast-shadow="true" />
      <TresPointLight :position="[4, 2, -2]" :intensity="0.8" color="#ff9944" :distance="8" />
      <TresPointLight :position="[-3, 2, 1]" :intensity="0.3" color="#ffcc88" :distance="6" />

      <Desk>
        <!-- Turntable -->
        <TresGroup :position="[-0.5, 0, -0.5]">
          <TurntableModel :is-playing="store.isPlaying" :rpm="store.rpm" />

          <!-- Vinyl on platter -->
          <TresGroup v-if="store.activeRecord" :position="[-0.5, 0.2, 0]">
            <VinylRecord
              :spinning="store.isPlaying"
              :rpm="store.rpm"
              :cover-art-url="store.activeRecord.coverArtUrl"
            />
          </TresGroup>
        </TresGroup>

        <!-- Record stack (selected records beside turntable) -->
        <TresGroup :position="[3.5, 0, 0.5]">
          <TresMesh
            v-for="(album, i) in recordStackAlbums"
            :key="album.id"
            :position-y="-0.4 + i * 0.08"
            :rotation-x="-Math.PI / 2"
            @click="selectFromStack(album)"
          >
            <TresBoxGeometry :args="[2.5, 2.5, 0.06]" />
            <TresMeshStandardMaterial
              :color="'#2a1f14'"
              :roughness="0.8"
            />
          </TresMesh>
        </TresGroup>
      </Desk>
    </TresCanvas>

    <!-- UI Overlay -->
    <div class="absolute inset-0 pointer-events-none">
      <!-- Top bar -->
      <div class="flex items-center justify-between p-4 pointer-events-auto">
        <button
          class="text-sm text-vinyl-amber/60 hover:text-vinyl-cream transition-colors flex items-center gap-2"
          @pointerdown="handleBack"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to store
        </button>

        <!-- Now playing -->
        <div v-if="store.activeRecord" class="text-right">
          <p class="text-sm font-display text-vinyl-cream">{{ store.activeRecord.title }}</p>
          <p class="text-xs text-vinyl-amber/60">{{ store.activeRecord.artist }}</p>
        </div>
      </div>

      <!-- Record Info panel -->
      <div v-if="store.activeRecord" class="absolute top-16 left-4 pointer-events-auto">
        <RecordInfo
          :album="store.activeRecord"
          :side="store.currentSide"
          :track-index="store.currentTrackIndex"
        />
      </div>

      <!-- Record stack UI -->
      <div
        v-if="store.selectedRecords.length > 1"
        class="absolute top-16 right-4 pointer-events-auto"
      >
        <div class="bg-vinyl-warm/90 backdrop-blur-sm rounded-lg p-3 border border-vinyl-amber/20">
          <p class="text-[10px] uppercase tracking-wider text-vinyl-amber/60 mb-2">Your Records</p>
          <div class="space-y-1">
            <button
              v-for="album in store.selectedRecords"
              :key="album.id"
              class="w-full text-left px-3 py-1.5 rounded text-xs transition-colors truncate max-w-48"
              :class="album.id === store.activeRecord?.id
                ? 'bg-vinyl-amber/20 text-vinyl-cream'
                : 'text-vinyl-amber/60 hover:text-vinyl-cream hover:bg-vinyl-brown/50'"
              @pointerdown="selectFromStack(album)"
            >
              {{ album.title }}
            </button>
          </div>
        </div>
      </div>

      <!-- Transport Controls -->
      <div class="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
        <TransportControls
          @toggle-play="turntable.togglePlayPause"
          @rewind="turntable.rewind"
          @fast-forward="turntable.fastForward"
          @previous-track="turntable.previousTrack"
          @next-track="turntable.nextTrack"
          @flip-side="turntable.flipRecord"
          @toggle-rpm="store.toggleRpm"
        />
      </div>

      <!-- Loading indicator -->
      <div
        v-if="turntable.audio.isLoading.value"
        class="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-2 text-vinyl-amber/60"
      >
        <div class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        <span class="text-xs italic">Finding the groove...</span>
      </div>

      <!-- Audio error -->
      <div
        v-if="turntable.audio.loadError.value"
        class="absolute bottom-28 left-1/2 -translate-x-1/2"
      >
        <p class="text-red-400/80 text-xs bg-red-900/20 px-3 py-1.5 rounded">
          {{ turntable.audio.loadError.value }}
        </p>
      </div>
    </div>
  </div>
</template>
