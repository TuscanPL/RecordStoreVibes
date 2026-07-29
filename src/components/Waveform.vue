<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'

const props = withDefaults(
  defineProps<{
    peaks: Float32Array | null
    /** Playhead position, 0..100. */
    progress: number
    /** Marker positions, each 0..100. */
    markers: number[]
    /**
     * Slice of the track to draw, as 0..1 fractions. Defaults to all of it.
     * The magnifier passes a narrow window, and may pass values outside
     * 0..1 near the ends so its centre stays honest — anything out of
     * bounds simply isn't drawn.
     */
    rangeStart?: number
    rangeEnd?: number
    /** Thinner bars suit the magnifier's short window. */
    dense?: boolean
  }>(),
  { rangeStart: 0, rangeEnd: 1, dense: false },
)

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
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

  const from = props.rangeStart
  const span = Math.max(1e-6, props.rangeEnd - from)
  /** Track fraction (0..1) → x. One mapping for bars, flags and playhead. */
  const toX = (f: number) => ((f - from) / span) * w

  const mid = h / 2
  const peaks = props.peaks
  const playFrac = props.progress / 100

  if (!peaks) {
    ctx.fillStyle = UNPLAYED
    ctx.fillRect(0, mid - 3, w, 6)
    ctx.fillStyle = PLAYED
    const px = Math.max(0, Math.min(w, toX(playFrac)))
    ctx.fillRect(0, mid - 3, px, 6)
  } else {
    const step = props.dense ? 2 : 3
    const bars = Math.max(24, Math.floor(w / step))
    const barW = w / bars
    const gap = barW > 2.5 ? 1 : 0

    for (let i = 0; i < bars; i++) {
      const f = from + ((i + 0.5) / bars) * span
      if (f < 0 || f > 1) continue
      const p = peaks[Math.min(peaks.length - 1, Math.floor(f * peaks.length))] ?? 0
      // Floor keeps silence visible as a hairline rather than nothing.
      const barH = Math.max(2, p * (h - 2))
      ctx.fillStyle = f <= playFrac ? PLAYED : UNPLAYED
      ctx.fillRect(i * barW, mid - barH / 2, Math.max(1, barW - gap), barH)
    }
  }

  // Flags: amber, full height, centred on the timestamp.
  ctx.fillStyle = MARKER
  for (const m of props.markers) {
    const x = toX(m / 100)
    if (x < -2 || x > w + 2) continue
    ctx.fillRect(Math.min(w - 2, Math.max(0, x - 1)), 0, 2, h)
  }

  // Playhead last, so it rides over any flag it passes.
  const hx = toX(playFrac)
  if (hx >= -3 && hx <= w + 3) {
    const cx = Math.min(w - 1.5, Math.max(1.5, hx))
    ctx.fillStyle = HEAD_EDGE
    ctx.fillRect(cx - 2.5, 0, 5, h)
    ctx.fillStyle = HEAD
    ctx.fillRect(cx - 1.5, 0, 3, h)
  }
}

watch(() => [props.peaks, props.progress, props.markers, props.rangeStart, props.rangeEnd], draw, {
  deep: true,
})

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
