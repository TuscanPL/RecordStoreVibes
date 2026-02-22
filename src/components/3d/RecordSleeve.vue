<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import * as THREE from 'three'

const props = withDefaults(defineProps<{
  width?: number
  height?: number
  depth?: number
  coverArtUrl?: string | null
  title?: string
  artist?: string
  year?: string | null
}>(), {
  width: 3.1,
  height: 3.1,
  depth: 0.05,
  title: 'Unknown Album',
  artist: 'Unknown Artist',
})

const frontTexture = ref<THREE.Texture | null>(null)
const backTexture = ref<THREE.Texture | null>(null)

// Load cover art for front
watch(() => props.coverArtUrl, (url) => {
  if (url) {
    const loader = new THREE.TextureLoader()
    loader.crossOrigin = 'anonymous'
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        frontTexture.value = tex
      },
      undefined,
      () => {
        // Failed to load, will use placeholder
        frontTexture.value = null
      }
    )
  }
}, { immediate: true })

// Generate back texture with album info
watch(() => [props.title, props.artist, props.year], () => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  // Background
  ctx.fillStyle = '#2a1f14'
  ctx.fillRect(0, 0, 512, 512)

  // Border
  ctx.strokeStyle = '#c8a96e'
  ctx.lineWidth = 4
  ctx.strokeRect(20, 20, 472, 472)

  // Title
  ctx.fillStyle = '#f5f0e1'
  ctx.font = 'bold 28px Georgia, serif'
  ctx.textAlign = 'center'
  wrapText(ctx, props.title, 256, 100, 400, 34)

  // Artist
  ctx.fillStyle = '#c8a96e'
  ctx.font = '22px Georgia, serif'
  ctx.fillText(props.artist, 256, 200)

  // Year
  if (props.year) {
    ctx.fillStyle = '#8a7a5a'
    ctx.font = '18px Georgia, serif'
    ctx.fillText(props.year, 256, 240)
  }

  // Attribution line
  ctx.fillStyle = '#5a4a3a'
  ctx.font = '12px sans-serif'
  ctx.fillText('Internet Archive — Public Domain', 256, 470)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  backTexture.value = tex
}, { immediate: true })

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ')
  let line = ''
  let testY = y

  for (const word of words) {
    const testLine = line + word + ' '
    const metrics = ctx.measureText(testLine)
    if (metrics.width > maxWidth && line !== '') {
      ctx.fillText(line.trim(), x, testY)
      line = word + ' '
      testY += lineHeight
    } else {
      line = testLine
    }
  }
  ctx.fillText(line.trim(), x, testY)
}

// Generate placeholder front texture when no cover art
const placeholderFrontTexture = computed(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  // Vintage colored background
  const colors = ['#8B4513', '#556B2F', '#4A3728', '#2F4F4F', '#6B3A3A', '#3A4A6B']
  const colorIdx = Math.abs(hashCode(props.title)) % colors.length
  ctx.fillStyle = colors[colorIdx] ?? '#4A3728'
  ctx.fillRect(0, 0, 512, 512)

  // Decorative border
  ctx.strokeStyle = '#c8a96e'
  ctx.lineWidth = 8
  ctx.strokeRect(30, 30, 452, 452)
  ctx.lineWidth = 2
  ctx.strokeRect(40, 40, 432, 432)

  // Title
  ctx.fillStyle = '#f5f0e1'
  ctx.font = 'bold 36px Georgia, serif'
  ctx.textAlign = 'center'
  wrapText(ctx, props.title, 256, 180, 380, 42)

  // Artist
  ctx.fillStyle = '#ddd0b8'
  ctx.font = '24px Georgia, serif'
  ctx.fillText(props.artist, 256, 350)

  // Year
  if (props.year) {
    ctx.fillStyle = '#aaa090'
    ctx.font = '20px Georgia, serif'
    ctx.fillText(props.year, 256, 390)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

const frontMaterial = computed(() => {
  const tex = frontTexture.value || placeholderFrontTexture.value
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.8,
    metalness: 0.0,
  })
})

const backMaterial = computed(() => {
  if (backTexture.value) {
    return new THREE.MeshStandardMaterial({
      map: backTexture.value,
      roughness: 0.8,
      metalness: 0.0,
    })
  }
  return new THREE.MeshStandardMaterial({
    color: '#2a1f14',
    roughness: 0.8,
    metalness: 0.0,
  })
})

const spineMaterial = new THREE.MeshStandardMaterial({
  color: '#1a1208',
  roughness: 0.9,
  metalness: 0.0,
})
</script>

<template>
  <TresGroup>
    <!-- Front face -->
    <TresMesh :position-z="depth / 2 + 0.001">
      <TresPlaneGeometry :args="[width, height]" />
      <primitive :object="frontMaterial" attach="material" />
    </TresMesh>

    <!-- Back face -->
    <TresMesh :position-z="-(depth / 2 + 0.001)" :rotation-y="Math.PI">
      <TresPlaneGeometry :args="[width, height]" />
      <primitive :object="backMaterial" attach="material" />
    </TresMesh>

    <!-- Spine (top) -->
    <TresMesh :position-y="height / 2" :rotation-x="Math.PI / 2">
      <TresPlaneGeometry :args="[width, depth]" />
      <primitive :object="spineMaterial" attach="material" />
    </TresMesh>

    <!-- Spine (bottom) -->
    <TresMesh :position-y="-height / 2" :rotation-x="-Math.PI / 2">
      <TresPlaneGeometry :args="[width, depth]" />
      <primitive :object="spineMaterial" attach="material" />
    </TresMesh>

    <!-- Spine (left) -->
    <TresMesh :position-x="-width / 2" :rotation-y="-Math.PI / 2">
      <TresPlaneGeometry :args="[depth, height]" />
      <primitive :object="spineMaterial" attach="material" />
    </TresMesh>

    <!-- Spine (right) -->
    <TresMesh :position-x="width / 2" :rotation-y="Math.PI / 2">
      <TresPlaneGeometry :args="[depth, height]" />
      <primitive :object="spineMaterial" attach="material" />
    </TresMesh>
  </TresGroup>
</template>
