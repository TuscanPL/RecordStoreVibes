import { ref } from 'vue'

/**
 * Under this, loading a waveform is cheap enough to just do.
 * A 78 sits comfortably here.
 */
export const INSTANT_MAX_SEC = 10 * 60

/**
 * Between INSTANT_MAX_SEC and this, it's offered with the download cost
 * shown — you're settling in to listen anyway. Past it, not offered at all:
 * the download stops being reasonable on cellular and the decode stops
 * being reasonable on a phone.
 */
export const OFFERED_MAX_SEC = 60 * 60

/** Bars drawn. More than this is invisible on a phone-width canvas. */
const BUCKETS = 800

/**
 * Decode target. Peaks don't need fidelity, and this is the difference
 * between a 60-minute file costing ~115 MB of PCM instead of ~1.2 GB.
 */
const DECODE_RATE = 8000

/** Rough MP3 bitrate for the pre-download estimate, since we only have duration. */
const ASSUMED_BYTES_PER_SEC = 16000

const cache = new Map<string, Float32Array>()

export function estimateBytes(durationSec: number): number {
  return durationSec * ASSUMED_BYTES_PER_SEC
}

export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

export function waveformTier(durationSec: number): 'instant' | 'offered' | 'too-long' {
  if (durationSec <= 0) return 'too-long'
  if (durationSec <= INSTANT_MAX_SEC) return 'instant'
  if (durationSec <= OFFERED_MAX_SEC) return 'offered'
  return 'too-long'
}

export function toPeaks(buffer: AudioBuffer, buckets: number = BUCKETS): Float32Array {
  const peaks = new Float32Array(buckets)
  const channels = buffer.numberOfChannels
  const per = Math.max(1, Math.floor(buffer.length / buckets))

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let b = 0; b < buckets; b++) {
      const start = b * per
      const end = Math.min(start + per, data.length)
      let max = 0
      // Stride large buckets: a long file has far more samples per bar
      // than we need to find its envelope.
      const step = Math.max(1, Math.floor((end - start) / 400))
      for (let i = start; i < end; i += step) {
        const v = data[i]! < 0 ? -data[i]! : data[i]!
        if (v > max) max = v
      }
      if (max > peaks[b]!) peaks[b] = max
    }
  }

  // Normalise so quiet transfers still render legibly.
  let ceiling = 0
  for (const p of peaks) if (p > ceiling) ceiling = p
  if (ceiling > 0) {
    for (let i = 0; i < peaks.length; i++) peaks[i] = peaks[i]! / ceiling
  }
  return peaks
}

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const Ctx: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext

  // decodeAudioData resamples to the context's rate, so decoding into a
  // low-rate offline context is what keeps memory sane.
  try {
    const ctx = new Ctx(1, 1, DECODE_RATE)
    return await ctx.decodeAudioData(bytes.slice(0))
  } catch {
    // Some WebKit builds reject unusual offline rates. Fall back to a normal
    // context — heavier, but this path only matters for short files.
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    try {
      return await ctx.decodeAudioData(bytes.slice(0))
    } finally {
      void ctx.close()
    }
  }
}

export function useWaveform() {
  const peaks = ref<Float32Array | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** 0..1 while downloading, null once decoding (which has no progress). */
  const progress = ref<number | null>(null)

  let activeUrl: string | null = null

  function reset(url: string | null) {
    activeUrl = url
    error.value = null
    progress.value = null
    loading.value = false
    peaks.value = url ? (cache.get(url) ?? null) : null
  }

  function isCached(url: string): boolean {
    return cache.has(url)
  }

  async function load(url: string) {
    if (cache.has(url)) {
      peaks.value = cache.get(url)!
      return
    }

    activeUrl = url
    loading.value = true
    error.value = null
    progress.value = 0

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))

      const total = Number(res.headers.get('content-length')) || 0
      let bytes: ArrayBuffer

      if (res.body && total > 0) {
        // Streamed so the long "hands off" files show real progress.
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          if (activeUrl !== url) return
          progress.value = Math.min(1, received / total)
        }
        const merged = new Uint8Array(received)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        bytes = merged.buffer
      } else {
        bytes = await res.arrayBuffer()
      }

      if (activeUrl !== url) return
      progress.value = null

      const buffer = await decode(bytes)
      if (activeUrl !== url) return

      const result = toPeaks(buffer)
      cache.set(url, result)
      peaks.value = result
    } catch {
      if (activeUrl !== url) return
      error.value = "Couldn't build a waveform for this one."
    } finally {
      if (activeUrl === url) {
        loading.value = false
        progress.value = null
      }
    }
  }

  return { peaks, loading, error, progress, load, reset, isCached }
}
