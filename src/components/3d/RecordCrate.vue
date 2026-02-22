<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Album } from '../../providers/types'
import RecordSleeve from './RecordSleeve.vue'

const props = defineProps<{
  albums: Album[]
  selectedIds: string[]
  inspectingIndex: number | null
  isFlipped?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-record', index: number): void
  (e: 'hover-record', index: number | null): void
}>()

const crateColor = '#5C3A1E'
const crateWidth = 4.0
const crateHeight = 3.5
const crateDepth = 7.0
const wallThickness = 0.15
const recordSize = 3.0

const usableDepth = crateDepth - wallThickness * 2 - 0.4

const slotSpacing = computed(() => usableDepth / Math.max(props.albums.length, 1))

const recordPositions = computed(() => {
  const spacing = slotSpacing.value
  return props.albums.map((_, i) => {
    const z = usableDepth / 2 - spacing * i - spacing / 2
    return z
  })
})

function getRecordTilt(index: number): number {
  if (props.inspectingIndex === null) return 0
  if (index === props.inspectingIndex) return -Math.PI / 3
  if (index < props.inspectingIndex) {
    const distance = props.inspectingIndex - index
    return -0.12 / distance
  }
  return 0
}

const hoveringIndex = ref<number | null>(null)
</script>

<template>
  <TresGroup>
    <!-- Crate bottom -->
    <TresMesh :position-y="-crateHeight / 2">
      <TresBoxGeometry :args="[crateWidth, wallThickness, crateDepth]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Back wall -->
    <TresMesh :position-z="-crateDepth / 2">
      <TresBoxGeometry :args="[crateWidth, crateHeight, wallThickness]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Front wall (shorter) -->
    <TresMesh :position-z="crateDepth / 2" :position-y="-crateHeight * 0.25">
      <TresBoxGeometry :args="[crateWidth, crateHeight * 0.5, wallThickness]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Left wall -->
    <TresMesh :position-x="-crateWidth / 2">
      <TresBoxGeometry :args="[wallThickness, crateHeight, crateDepth]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Right wall -->
    <TresMesh :position-x="crateWidth / 2">
      <TresBoxGeometry :args="[wallThickness, crateHeight, crateDepth]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Records (packed front-to-back along Z) -->
    <TresGroup
      v-for="(album, index) in albums"
      :key="album.id"
      :position-z="recordPositions[index] || 0"
      :position-y="-crateHeight / 2 + wallThickness / 2 + (inspectingIndex === index ? 3.0 : 0)"
    >
      <!-- Click target: horizontal plane covering the slot -->
      <TresMesh
        :position-y="recordSize * 0.9"
        :rotation-x="-Math.PI / 2"
        @pointer-down="() => emit('select-record', index)"
        @pointer-enter="() => { hoveringIndex = index; emit('hover-record', index) }"
        @pointer-leave="() => { if (hoveringIndex === index) { hoveringIndex = null; emit('hover-record', null) } }"
      >
        <TresPlaneGeometry :args="[recordSize, slotSpacing]" />
        <TresMeshBasicMaterial :transparent="true" :opacity="0.001" :depth-write="false" :side="2" />
      </TresMesh>

      <!-- Pivot at bottom edge of record -->
      <TresGroup :rotation-x="getRecordTilt(index)">
        <!-- Record body, shifted up so bottom sits at pivot -->
        <TresGroup
          :position-y="recordSize / 2"
          :rotation-y="inspectingIndex === index && isFlipped ? Math.PI : 0"
        >
          <RecordSleeve
            :width="recordSize"
            :height="recordSize"
            :cover-art-url="album.coverArtUrl"
            :title="album.title"
            :artist="album.artist"
            :year="album.year"
            :hovered="hoveringIndex === index"
            :selected="selectedIds.includes(album.id)"
          />
        </TresGroup>
      </TresGroup>
    </TresGroup>
  </TresGroup>
</template>
