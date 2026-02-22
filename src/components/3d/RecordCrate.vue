<script setup lang="ts">
import { computed } from 'vue'
import type { Album } from '../../providers/types'

const props = defineProps<{
  albums: Album[]
  selectedIds: string[]
  inspectingIndex: number | null
}>()

const emit = defineEmits<{
  (e: 'select-record', index: number): void
}>()

const crateColor = '#5C3A1E'
const crateWidth = 8
const crateHeight = 3.5
const crateDepth = 3.5
const wallThickness = 0.15

const recordPositions = computed(() => {
  return props.albums.map((_, i) => {
    const totalWidth = crateWidth - wallThickness * 2 - 0.5
    const spacing = totalWidth / Math.max(props.albums.length, 1)
    const x = -totalWidth / 2 + spacing * i + spacing / 2
    return { x, y: 0, z: 0 }
  })
})
</script>

<template>
  <TresGroup>
    <!-- Crate bottom -->
    <TresMesh :position-y="-crateHeight / 2">
      <TresBoxGeometry :args="[crateWidth, wallThickness, crateDepth]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Crate back wall -->
    <TresMesh :position-z="-crateDepth / 2" :position-y="0">
      <TresBoxGeometry :args="[crateWidth, crateHeight, wallThickness]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Crate front wall (shorter) -->
    <TresMesh :position-z="crateDepth / 2" :position-y="-crateHeight * 0.15">
      <TresBoxGeometry :args="[crateWidth, crateHeight * 0.7, wallThickness]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Crate left wall -->
    <TresMesh :position-x="-crateWidth / 2">
      <TresBoxGeometry :args="[wallThickness, crateHeight, crateDepth]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Crate right wall -->
    <TresMesh :position-x="crateWidth / 2">
      <TresBoxGeometry :args="[wallThickness, crateHeight, crateDepth]" />
      <TresMeshStandardMaterial :color="crateColor" :roughness="0.9" />
    </TresMesh>

    <!-- Records in crate (as thin box spines) -->
    <TresGroup
      v-for="(album, index) in albums"
      :key="album.id"
      :position-x="recordPositions[index]?.x || 0"
      :position-y="inspectingIndex === index ? 2.0 : 0"
      :position-z="inspectingIndex === index ? 1.5 : 0"
    >
      <TresMesh @pointer-down="() => emit('select-record', index)">
        <TresBoxGeometry :args="[0.25, 3.0, 3.0]" />
        <TresMeshStandardMaterial
          :color="selectedIds.includes(album.id) ? '#c8a96e' : '#2a1f14'"
          :roughness="0.8"
          :emissive="selectedIds.includes(album.id) ? '#3a2a10' : '#000000'"
          :emissive-intensity="0.3"
        />
      </TresMesh>

      <!-- Spine label (top edge visible) -->
      <TresMesh :position-y="1.55" :rotation-x="-Math.PI / 2" @pointer-down="() => emit('select-record', index)">
        <TresPlaneGeometry :args="[0.25, 3.0]" />
        <TresMeshStandardMaterial
          :color="selectedIds.includes(album.id) ? '#e8c87e' : '#3a2a14'"
          :roughness="0.7"
        />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
