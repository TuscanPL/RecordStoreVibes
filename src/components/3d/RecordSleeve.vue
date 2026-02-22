<script setup lang="ts">
import { ref, watch, computed, watchEffect } from 'vue'
import * as THREE from 'three'

const props = withDefaults(defineProps<{
  width?: number
  height?: number
  depth?: number
  coverArtUrl?: string | null
  title?: string
  artist?: string
  year?: string | null
  hovered?: boolean
  selected?: boolean
}>(), {
  width: 3.1,
  height: 3.1,
  depth: 0.05,
  title: 'Unknown Album',
  artist: 'Unknown Artist',
  hovered: false,
  selected: false,
})

// Module-level texture cache — survives component unmount/remount
const textureCache = new Map<string, THREE.Texture>()

const frontTexture = ref<THREE.Texture | null>(null)

// Load cover art for front (with cache)
watch(() => props.coverArtUrl, (url) => {
  if (url) {
    const cached = textureCache.get(url)
    if (cached) {
      frontTexture.value = cached
      return
    }
    const loader = new THREE.TextureLoader()
    loader.crossOrigin = 'anonymous'
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        textureCache.set(url, tex)
        frontTexture.value = tex
      },
      undefined,
      () => { frontTexture.value = null }
    )
  }
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

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

// Generate placeholder front texture when no cover art
const placeholderFrontTexture = computed(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  const colors = ['#8B4513', '#556B2F', '#4A3728', '#2F4F4F', '#6B3A3A', '#3A4A6B']
  const colorIdx = Math.abs(hashCode(props.title)) % colors.length
  ctx.fillStyle = colors[colorIdx] ?? '#4A3728'
  ctx.fillRect(0, 0, 512, 512)

  ctx.strokeStyle = '#c8a96e'
  ctx.lineWidth = 8
  ctx.strokeRect(30, 30, 452, 452)
  ctx.lineWidth = 2
  ctx.strokeRect(40, 40, 432, 432)

  ctx.fillStyle = '#f5f0e1'
  ctx.font = 'bold 36px Georgia, serif'
  ctx.textAlign = 'center'
  wrapText(ctx, props.title, 256, 180, 380, 42)

  ctx.fillStyle = '#ddd0b8'
  ctx.font = '24px Georgia, serif'
  ctx.fillText(props.artist, 256, 350)

  if (props.year) {
    ctx.fillStyle = '#aaa090'
    ctx.font = '20px Georgia, serif'
    ctx.fillText(props.year, 256, 390)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})

// Generate back texture with album info
const backCanvasTexture = computed(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#2a1f14'
  ctx.fillRect(0, 0, 512, 512)

  ctx.strokeStyle = '#c8a96e'
  ctx.lineWidth = 4
  ctx.strokeRect(20, 20, 472, 472)

  ctx.fillStyle = '#f5f0e1'
  ctx.font = 'bold 28px Georgia, serif'
  ctx.textAlign = 'center'
  wrapText(ctx, props.title, 256, 100, 400, 34)

  ctx.fillStyle = '#c8a96e'
  ctx.font = '22px Georgia, serif'
  ctx.fillText(props.artist, 256, 200)

  if (props.year) {
    ctx.fillStyle = '#8a7a5a'
    ctx.font = '18px Georgia, serif'
    ctx.fillText(props.year, 256, 240)
  }

  ctx.fillStyle = '#5a4a3a'
  ctx.font = '12px sans-serif'
  ctx.fillText('Internet Archive — Public Domain', 256, 470)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
})

// Persistent material objects — mutated in place, never recreated
const spineMaterial = new THREE.MeshStandardMaterial({
  color: '#1a1208',
  roughness: 0.9,
  metalness: 0.0,
})

const frontMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.8,
  metalness: 0.0,
})

const backMaterial = new THREE.MeshStandardMaterial({
  color: '#2a1f14',
  roughness: 0.8,
  metalness: 0.0,
})

// BoxGeometry material order: [+X, -X, +Y, -Y, +Z (front), -Z (back)]
const materialArray = [
  spineMaterial, // +X (right)
  spineMaterial, // -X (left)
  spineMaterial, // +Y (top)
  spineMaterial, // -Y (bottom)
  frontMaterial, // +Z (front - cover art)
  backMaterial,  // -Z (back - album info)
]

// Update front material texture when it changes
watchEffect(() => {
  const tex = frontTexture.value || placeholderFrontTexture.value
  frontMaterial.map = tex
  frontMaterial.needsUpdate = true
})

// Update back material texture when it changes
watchEffect(() => {
  backMaterial.map = backCanvasTexture.value
  backMaterial.needsUpdate = true
})

// Update spine appearance for hover/selection state
watchEffect(() => {
  if (props.selected) {
    spineMaterial.color.set('#c8a96e')
    spineMaterial.emissive.set('#3a2a10')
    spineMaterial.emissiveIntensity = 0.3
  } else if (props.hovered) {
    spineMaterial.color.set('#4a3a28')
    spineMaterial.emissive.set('#c8a96e')
    spineMaterial.emissiveIntensity = 0.4
  } else {
    spineMaterial.color.set('#1a1208')
    spineMaterial.emissive.set('#000000')
    spineMaterial.emissiveIntensity = 0
  }
})
</script>

<template>
  <TresMesh>
    <TresBoxGeometry :args="[width, height, depth]" />
    <primitive :object="materialArray" attach="material" />
  </TresMesh>
</template>
