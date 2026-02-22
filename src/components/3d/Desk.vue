<script setup lang="ts">
</script>

<template>
  <TresGroup>
    <!-- Desktop surface -->
    <TresMesh :position-y="-0.6" :receive-shadow="true">
      <TresBoxGeometry :args="[10, 0.15, 7]" />
      <TresMeshStandardMaterial color="#3d2b1f" :roughness="0.8" :metalness="0.05" />
    </TresMesh>

    <!-- Desk legs -->
    <TresMesh :position="[-4.5, -3.0, -3.0]">
      <TresBoxGeometry :args="[0.2, 4.5, 0.2]" />
      <TresMeshStandardMaterial color="#2a1f14" :roughness="0.9" />
    </TresMesh>
    <TresMesh :position="[4.5, -3.0, -3.0]">
      <TresBoxGeometry :args="[0.2, 4.5, 0.2]" />
      <TresMeshStandardMaterial color="#2a1f14" :roughness="0.9" />
    </TresMesh>
    <TresMesh :position="[-4.5, -3.0, 3.0]">
      <TresBoxGeometry :args="[0.2, 4.5, 0.2]" />
      <TresMeshStandardMaterial color="#2a1f14" :roughness="0.9" />
    </TresMesh>
    <TresMesh :position="[4.5, -3.0, 3.0]">
      <TresBoxGeometry :args="[0.2, 4.5, 0.2]" />
      <TresMeshStandardMaterial color="#2a1f14" :roughness="0.9" />
    </TresMesh>

    <!-- Desk lamp -->
    <TresGroup :position="[4.0, 0, -2.5]">
      <!-- Lamp base -->
      <TresMesh :position-y="-0.4">
        <TresCylinderGeometry :args="[0.3, 0.35, 0.1, 16]" />
        <TresMeshStandardMaterial color="#1a1208" :roughness="0.4" :metalness="0.6" />
      </TresMesh>
      <!-- Lamp arm -->
      <TresMesh :position-y="0.5" :rotation-z="0.15">
        <TresCylinderGeometry :args="[0.02, 0.02, 1.8, 8]" />
        <TresMeshStandardMaterial color="#888888" :roughness="0.3" :metalness="0.7" />
      </TresMesh>
      <!-- Lamp shade -->
      <TresMesh :position="[0.15, 1.3, 0]" :rotation-z="0.3">
        <TresConeGeometry :args="[0.3, 0.4, 16, 1, true]" />
        <TresMeshStandardMaterial color="#c47d3b" :roughness="0.7" :side="2" />
      </TresMesh>
    </TresGroup>

    <!-- Slot for the default content -->
    <slot />
  </TresGroup>
</template>
