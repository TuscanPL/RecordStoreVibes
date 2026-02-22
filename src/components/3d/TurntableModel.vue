<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  isPlaying?: boolean
  rpm?: 33 | 45
}>(), {
  isPlaying: false,
  rpm: 33,
})

const tonearmRotation = ref(0)

watch(() => props.isPlaying, (playing) => {
  // Tonearm swings in when playing, out when paused
  tonearmRotation.value = playing ? -0.25 : 0
})

const baseColor = '#1a1208'
const platterColor = '#222222'
const metalColor = '#888888'
</script>

<template>
  <TresGroup>
    <!-- Base / plinth -->
    <TresMesh :position-y="-0.15">
      <TresBoxGeometry :args="[6, 0.3, 5]" />
      <TresMeshStandardMaterial :color="baseColor" :roughness="0.7" :metalness="0.1" />
    </TresMesh>

    <!-- Top plate -->
    <TresMesh :position-y="0.01">
      <TresBoxGeometry :args="[5.8, 0.02, 4.8]" />
      <TresMeshStandardMaterial color="#2a1f14" :roughness="0.6" :metalness="0.1" />
    </TresMesh>

    <!-- Platter (where record sits) -->
    <TresMesh :position="[-0.5, 0.05, 0]">
      <TresCylinderGeometry :args="[1.7, 1.7, 0.08, 64]" />
      <TresMeshStandardMaterial :color="platterColor" :roughness="0.3" :metalness="0.6" />
    </TresMesh>

    <!-- Platter mat -->
    <TresMesh :position="[-0.5, 0.1, 0]">
      <TresCylinderGeometry :args="[1.6, 1.6, 0.02, 64]" />
      <TresMeshStandardMaterial color="#333333" :roughness="0.9" :metalness="0.0" />
    </TresMesh>

    <!-- Spindle -->
    <TresMesh :position="[-0.5, 0.15, 0]">
      <TresCylinderGeometry :args="[0.03, 0.03, 0.2, 16]" />
      <TresMeshStandardMaterial :color="metalColor" :roughness="0.2" :metalness="0.8" />
    </TresMesh>

    <!-- Tonearm base -->
    <TresGroup :position="[2.0, 0.15, -1.5]">
      <!-- Pivot base -->
      <TresMesh>
        <TresCylinderGeometry :args="[0.15, 0.15, 0.2, 16]" />
        <TresMeshStandardMaterial :color="metalColor" :roughness="0.2" :metalness="0.8" />
      </TresMesh>

      <!-- Tonearm -->
      <TresGroup :rotation-y="tonearmRotation">
        <!-- Arm -->
        <TresMesh :position="[-1.2, 0.15, 0.7]" :rotation-z="0.02">
          <TresBoxGeometry :args="[2.5, 0.04, 0.04]" />
          <TresMeshStandardMaterial :color="metalColor" :roughness="0.2" :metalness="0.8" />
        </TresMesh>

        <!-- Headshell -->
        <TresMesh :position="[-2.4, 0.14, 0.7]">
          <TresBoxGeometry :args="[0.2, 0.06, 0.08]" />
          <TresMeshStandardMaterial :color="metalColor" :roughness="0.3" :metalness="0.7" />
        </TresMesh>

        <!-- Counterweight -->
        <TresMesh :position="[0.3, 0.15, 0.7]" :rotation-x="-Math.PI / 2">
          <TresCylinderGeometry :args="[0.1, 0.1, 0.12, 16]" />
          <TresMeshStandardMaterial color="#333333" :roughness="0.4" :metalness="0.5" />
        </TresMesh>
      </TresGroup>
    </TresGroup>

    <!-- RPM switch area -->
    <TresMesh :position="[2.2, 0.05, 1.5]">
      <TresBoxGeometry :args="[0.6, 0.08, 0.3]" />
      <TresMeshStandardMaterial color="#333333" :roughness="0.5" :metalness="0.3" />
    </TresMesh>

    <!-- Power indicator -->
    <TresMesh :position="[2.2, 0.1, 1.5]" :rotation-x="-Math.PI / 2">
      <TresCircleGeometry :args="[0.04, 16]" />
      <TresMeshStandardMaterial
        :color="isPlaying ? '#4CAF50' : '#666666'"
        :emissive="isPlaying ? '#4CAF50' : '#000000'"
        :emissive-intensity="isPlaying ? 0.5 : 0"
      />
    </TresMesh>
  </TresGroup>
</template>
