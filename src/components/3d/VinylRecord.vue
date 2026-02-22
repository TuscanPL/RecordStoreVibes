<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import * as THREE from 'three'

const props = withDefaults(defineProps<{
  radius?: number
  thickness?: number
  color?: string
  labelColor?: string
  spinning?: boolean
  rpm?: 33 | 45
  coverArtUrl?: string | null
}>(), {
  radius: 1.5,
  thickness: 0.02,
  color: '#111111',
  labelColor: '#c8a96e',
  spinning: false,
  rpm: 33,
})

const groupRef = ref<THREE.Group | null>(null)
const rotation = ref(0)
let animationId: number | null = null
let lastTime = 0

const labelTexture = ref<THREE.Texture | null>(null)

watch(() => props.coverArtUrl, (url) => {
  if (url) {
    const loader = new THREE.TextureLoader()
    loader.crossOrigin = 'anonymous'
    loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      labelTexture.value = tex
    })
  }
}, { immediate: true })

const vinylMaterial = computed(() => {
  return new THREE.MeshStandardMaterial({
    color: props.color,
    metalness: 0.3,
    roughness: 0.4,
  })
})

const labelMaterial = computed(() => {
  if (labelTexture.value) {
    return new THREE.MeshStandardMaterial({
      map: labelTexture.value,
      metalness: 0.1,
      roughness: 0.6,
    })
  }
  return new THREE.MeshStandardMaterial({
    color: props.labelColor,
    metalness: 0.1,
    roughness: 0.6,
  })
})

function animate(time: number) {
  if (!props.spinning) {
    lastTime = time
    animationId = requestAnimationFrame(animate)
    return
  }

  const delta = (time - lastTime) / 1000
  lastTime = time

  const rpmSpeed = props.rpm === 45 ? 4.71 : 3.49
  rotation.value += rpmSpeed * delta

  if (groupRef.value) {
    groupRef.value.rotation.y = rotation.value
  }

  animationId = requestAnimationFrame(animate)
}

watch(() => props.spinning, (spinning) => {
  if (spinning && !animationId) {
    lastTime = performance.now()
    animationId = requestAnimationFrame(animate)
  }
}, { immediate: true })

// Start animation loop
lastTime = performance.now()
animationId = requestAnimationFrame(animate)
</script>

<template>
  <TresGroup ref="groupRef">
    <!-- Main disc -->
    <TresMesh>
      <TresCylinderGeometry :args="[radius, radius, thickness, 64]" />
      <primitive :object="vinylMaterial" attach="material" />
    </TresMesh>

    <!-- Grooves (subtle rings) -->
    <TresMesh :rotation-x="-Math.PI / 2" :position-y="thickness / 2 + 0.001">
      <TresRingGeometry :args="[radius * 0.35, radius * 0.98, 64]" />
      <TresMeshStandardMaterial
        color="#0a0a0a"
        :metalness="0.5"
        :roughness="0.3"
        :transparent="true"
        :opacity="0.5"
      />
    </TresMesh>

    <!-- Center label -->
    <TresMesh :rotation-x="-Math.PI / 2" :position-y="thickness / 2 + 0.002">
      <TresCircleGeometry :args="[radius * 0.33, 64]" />
      <primitive :object="labelMaterial" attach="material" />
    </TresMesh>

    <!-- Center hole -->
    <TresMesh :rotation-x="-Math.PI / 2" :position-y="thickness / 2 + 0.003">
      <TresCircleGeometry :args="[radius * 0.02, 32]" />
      <TresMeshStandardMaterial color="#1a1a1a" />
    </TresMesh>
  </TresGroup>
</template>
