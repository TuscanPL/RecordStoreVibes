<script setup lang="ts">
import { ref, computed } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { useAppStore } from '../../stores/app'
import { useProvider } from '../../composables/useProvider'
import RecordCrate from '../../components/3d/RecordCrate.vue'
import RecordSleeve from '../../components/3d/RecordSleeve.vue'
import SelectionCounter from '../../components/ui/SelectionCounter.vue'
import ClerkDialog from '../../components/ui/ClerkDialog.vue'
import type { Album } from '../../providers/types'

const store = useAppStore()
const { askTheClerk, error } = useProvider()

const inspectingIndex = ref<number | null>(null)
const inspectingAlbum = ref<Album | null>(null)
const isFlipped = ref(false)
const clerkVisible = ref(false)

const selectedIds = computed(() => store.selectedRecords.map(r => r.id))

function handleRecordClick(index: number) {
  if (inspectingIndex.value === index) {
    // Close inspection
    inspectingIndex.value = null
    inspectingAlbum.value = null
    isFlipped.value = false
  } else {
    inspectingIndex.value = index
    inspectingAlbum.value = store.currentCrate[index] || null
    isFlipped.value = false
  }
}

function flipInspectedRecord() {
  isFlipped.value = !isFlipped.value
}

function toggleSelectRecord() {
  if (!inspectingAlbum.value) return

  if (store.isRecordSelected(inspectingAlbum.value.id)) {
    store.deselectRecord(inspectingAlbum.value.id)
  } else {
    store.selectRecord(inspectingAlbum.value)
  }
}

async function handleAskClerk() {
  clerkVisible.value = true
  inspectingIndex.value = null
  inspectingAlbum.value = null
  isFlipped.value = false

  await askTheClerk()

  setTimeout(() => {
    clerkVisible.value = false
  }, 2000)
}

function handleLeaveStore() {
  store.goToTurntable()
}
</script>

<template>
  <div class="absolute inset-0">
    <!-- 3D Scene -->
    <TresCanvas :clear-color="'#0a0805'" :shadows="true">
      <!-- Camera -->
      <TresPerspectiveCamera :position="[0, 4, 7]" :look-at="[0, 0, 0]" />

      <!-- Lighting -->
      <TresAmbientLight :intensity="0.3" color="#ffe4c4" />
      <TresDirectionalLight :position="[3, 5, 2]" :intensity="0.8" color="#ffd4a0" :cast-shadow="true" />
      <TresPointLight :position="[-2, 3, 1]" :intensity="0.5" color="#ff9944" :distance="10" />

      <!-- Record Crate -->
      <RecordCrate
        :albums="store.currentCrate"
        :selected-ids="selectedIds"
        :inspecting-index="inspectingIndex"
        @select-record="handleRecordClick"
      />

      <!-- Inspecting record (pulled out) -->
      <TresGroup
        v-if="inspectingAlbum"
        :position="[0, 3.5, 3]"
        :rotation-y="isFlipped ? Math.PI : 0"
      >
        <RecordSleeve
          :cover-art-url="inspectingAlbum.coverArtUrl"
          :title="inspectingAlbum.title"
          :artist="inspectingAlbum.artist"
          :year="inspectingAlbum.year"
          :width="3.1"
          :height="3.1"
        />
      </TresGroup>

      <!-- Floor -->
      <TresMesh :rotation-x="-Math.PI / 2" :position-y="-2">
        <TresPlaneGeometry :args="[20, 20]" />
        <TresMeshStandardMaterial color="#1a1208" :roughness="0.95" />
      </TresMesh>
    </TresCanvas>

    <!-- UI Overlay -->
    <div class="absolute inset-0 pointer-events-none">
      <!-- Top bar -->
      <div class="flex items-center justify-between p-4 pointer-events-auto">
        <div class="text-sm text-vinyl-amber/60 font-body">
          <span class="uppercase tracking-wider">{{ store.selectedGenre }}</span>
          <span class="mx-2 text-vinyl-amber/30">|</span>
          <span>Crate #{{ store.crateRequestCount }}</span>
        </div>

        <SelectionCounter />
      </div>

      <!-- Inspecting record controls -->
      <div
        v-if="inspectingAlbum"
        class="absolute bottom-32 left-1/2 -translate-x-1/2 flex items-center gap-3 pointer-events-auto"
      >
        <!-- Flip button -->
        <button
          class="px-4 py-2 rounded-lg bg-vinyl-warm/90 border border-vinyl-amber/20
                 text-vinyl-cream text-sm hover:bg-vinyl-brown transition-colors"
          @pointerdown="flipInspectedRecord"
        >
          Flip Record
        </button>

        <!-- Select / Deselect -->
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="store.isRecordSelected(inspectingAlbum.id)
            ? 'bg-vinyl-amber text-vinyl-warm hover:bg-vinyl-orange'
            : store.canSelectMore
              ? 'bg-vinyl-warm/90 border border-vinyl-amber/20 text-vinyl-cream hover:bg-vinyl-brown'
              : 'bg-vinyl-warm/50 border border-vinyl-amber/10 text-vinyl-amber/30 cursor-not-allowed'"
          :disabled="!store.isRecordSelected(inspectingAlbum.id) && !store.canSelectMore"
          @pointerdown="toggleSelectRecord"
        >
          {{ store.isRecordSelected(inspectingAlbum.id) ? 'Put Back' : 'Take This One' }}
        </button>

        <!-- Close button -->
        <button
          class="px-4 py-2 rounded-lg bg-vinyl-warm/90 border border-vinyl-amber/20
                 text-vinyl-cream/60 text-sm hover:text-vinyl-cream transition-colors"
          @pointerdown="handleRecordClick(inspectingIndex!)"
        >
          Close
        </button>
      </div>

      <!-- Record info panel -->
      <div v-if="inspectingAlbum" class="absolute top-20 right-4 pointer-events-auto">
        <div class="bg-vinyl-warm/90 backdrop-blur-sm rounded-lg p-4 border border-vinyl-amber/20 max-w-xs">
          <h3 class="font-display font-bold text-vinyl-cream text-sm">{{ inspectingAlbum.title }}</h3>
          <p class="text-vinyl-amber text-xs mt-1">{{ inspectingAlbum.artist }}</p>
          <p v-if="inspectingAlbum.year" class="text-vinyl-amber/60 text-xs">{{ inspectingAlbum.year }}</p>

          <!-- Track listing -->
          <div class="mt-3 border-t border-vinyl-amber/10 pt-2">
            <p class="text-[10px] uppercase tracking-wider text-vinyl-amber/50 mb-1">Side A</p>
            <div
              v-for="track in inspectingAlbum.sides.A.tracks"
              :key="track.id"
              class="text-xs text-vinyl-cream/60 py-0.5 truncate"
            >
              {{ track.title }}
            </div>
            <template v-if="inspectingAlbum.sides.B.tracks.length > 0">
              <p class="text-[10px] uppercase tracking-wider text-vinyl-amber/50 mb-1 mt-2">Side B</p>
              <div
                v-for="track in inspectingAlbum.sides.B.tracks"
                :key="track.id"
                class="text-xs text-vinyl-cream/60 py-0.5 truncate"
              >
                {{ track.title }}
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 pointer-events-auto">
        <!-- Ask the Clerk -->
        <button
          class="px-5 py-2.5 rounded-lg bg-vinyl-warm/90 border border-vinyl-amber/20
                 text-vinyl-amber text-sm hover:bg-vinyl-brown hover:text-vinyl-cream
                 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="store.isLoadingCrate"
          @pointerdown="handleAskClerk"
        >
          {{ store.isLoadingCrate ? 'Digging...' : 'Ask the Clerk' }}
        </button>

        <!-- Leave store -->
        <button
          v-if="store.canLeaveStore"
          class="px-5 py-2.5 rounded-lg bg-vinyl-amber text-vinyl-warm text-sm font-medium
                 hover:bg-vinyl-cream transition-colors"
          @pointerdown="handleLeaveStore"
        >
          Leave the Store ({{ store.selectedRecords.length }} record{{ store.selectedRecords.length > 1 ? 's' : '' }})
        </button>
      </div>

      <!-- Clerk dialog -->
      <div class="absolute bottom-20 left-4 pointer-events-none">
        <ClerkDialog :visible="clerkVisible || store.isLoadingCrate" />
      </div>

      <!-- Error -->
      <div v-if="error" class="absolute top-16 left-1/2 -translate-x-1/2">
        <p class="text-red-400/80 text-sm bg-red-900/20 px-4 py-2 rounded-lg">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
