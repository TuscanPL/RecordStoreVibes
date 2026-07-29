<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  peaks: Float32Array | null
  /** 0..100 */
  progress: number
  /** Marker positions as 0..100. */
  markers: number[]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | null = null

/*
 * Four things share this strip and all need to stay apart:
 * unplayed → played → flag → playhead, dimmest to brightest.
 * Amber is the flag colour everywhere else in the app, so it belongs to the
 * markers here; the played region takes the muted tan a step below it.
 */
const UNPLAYED = '#4a3f33'
const PLAYED = '#8a7454'
const MARKER = '#d99a4e'
const HEAD = '#f2ece0'
const HEAD_EDGE = 'rgba(14, 12, 10, 0.85)'

function draw() {
  const el = canvas.value
  if (!el) return

  const dpr = window.devicePixelRatio || 1
  const w = el.clientWidth
  const h = el.clientHeight
  if (w === 0 || h === 0) return

  if (el.width !== w * dpr || el.height !== h * dpr) {
    el.width = w * dpr
    el.height = h * dpr
  }

  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const mid = h / 2
  const peaks = props.peaks

  if (!peaks) {
    // No waveform loaded — plain bar, same as before.
    ctx.fillStyle = UNPLAYED
    ctx.fillRect(0, mid - 3, w, 6)
    ctx.fillStyle = PLAYED
    ctx.fillRect(0, mid - 3, w * (props.progress / 100), 6)
  } else {
    const bars = Math.min(peaks.length, Math.max(40, Math.floor(w / 2)))
    const barW = w / bars
    const gap = barW > 3 ? 1 : 0
    const playedX = w * (props.progress / 100)

    for (let i = 0; i < bars; i++) {
      const p = peaks[Math.floor((i / bars) * peaks.length)] ?? 0
      // Floor keeps silence visible as a hairline rather than nothing.
      const barH = Math.max(2, p * (h - 2))
      const x = i * barW
      ctx.fillStyle = x + barW <= playedX ? PLAYED : UNPLAYED
      ctx.fillRect(x, mid - barH / 2, Math.max(1, barW - gap), barH)
    }
  }

  // Flags: amber, full height, centred on the timestamp.
  ctx.fillStyle = MARKER
  for (const m of props.markers) {
    const x = (m / 100) * w
    ctx.fillRect(Math.min(w - 2, Math.max(0, x - 1)), 0, 2, h)
  }

  // Playhead last, so it rides over the flags it passes.
  //
  // Drawn here rather than relying on the range input's thumb: the browser
  // insets that thumb so it can't overflow the track, giving it a travel of
  // (w - thumbWidth) against the bars' full w. That put the line up to half
  // a thumb-width away from the audio it was pointing at — worst at the
  // start and end of a track. Everything on this canvas shares one linear
  // time -> x mapping instead.
  const hx = Math.min(w - 1.5, Math.max(1.5, (props.progress / 100) * w))
  ctx.fillStyle = HEAD_EDGE
  ctx.fillRect(hx - 2.5, 0, 5, h)
  ctx.fillStyle = HEAD
  ctx.fillRect(hx - 1.5, 0, 3, h)
}

watch(() => [props.peaks, props.progress, props.markers], draw, { deep: true })

onMounted(() => {
  draw()
  if ('ResizeObserver' in window && canvas.value) {
    observer = new ResizeObserver(draw)
    observer.observe(canvas.value)
  }
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <canvas ref="canvas" class="w-full h-full block" />
</template>
