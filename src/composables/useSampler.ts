import { ref, shallowRef } from 'vue'
import type { Pad } from '../stores/storage'
import { toPeaks } from './useWaveform'

/**
 * Peak decoded PCM we're willing to hold. Decoding is what limits this, not
 * downloading: float32 stereo at 44.1kHz is ~0.35 MB per second, so an hour
 * would be 1.2 GB and would take the tab out.
 */
const PCM_BUDGET = 150 * 1024 * 1024

/** Below this, resampling has destroyed too much to judge a sample by. */
const MIN_RATE = 6000
const NATIVE_RATE = 44100

/** Past this the decode can't be made to fit at a rate worth listening to. */
export const SAMPLER_MAX_SEC = 60 * 60

/**
 * Highest rate whose decode fits the budget. Short tracks — 78s, songs, the
 * things you'd most want to chop — come through untouched; only long sets
 * get resampled, and the view says so.
 */
export function decodeRateFor(durationSec: number): number {
  if (durationSec <= 0) return NATIVE_RATE
  // Assume stereo: we can't know the channel count until it's decoded, and
  // guessing low is what blows the budget.
  const fits = Math.floor(PCM_BUDGET / (durationSec * 2 * 4))
  return Math.max(MIN_RATE, Math.min(NATIVE_RATE, fits))
}

export function semitonesToRate(semitones: number): number {
  return Math.pow(2, semitones / 12)
}

/**
 * Downloaded bytes, kept for the session so a track is only pulled once.
 *
 * Compressed bytes, not decoded audio: a 10-minute MP3 is ~10 MB here versus
 * ~150 MB decoded, so several tracks fit in the space one buffer would take.
 * Re-decoding on return costs a second or two and no data.
 */
const byteCache = new Map<string, ArrayBuffer>()
const BYTE_CACHE_MAX = 100 * 1024 * 1024

function cacheBytes(url: string, bytes: ArrayBuffer) {
  byteCache.set(url, bytes)
  let held = 0
  for (const b of byteCache.values()) held += b.byteLength
  // Oldest out first — Map iterates in insertion order.
  for (const k of byteCache.keys()) {
    if (held <= BYTE_CACHE_MAX) break
    held -= byteCache.get(k)!.byteLength
    byteCache.delete(k)
  }
}

export function isDownloaded(url: string): boolean {
  return byteCache.has(url)
}

let ctx: AudioContext | null = null
function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

const buffer = shallowRef<AudioBuffer | null>(null)
const peaks = shallowRef<Float32Array | null>(null)
const loadedUrl = ref<string | null>(null)
const loading = ref(false)
const progress = ref<number | null>(null)
const error = ref<string | null>(null)
const rate = ref(0)
const playing = ref<number | null>(null)

/**
 * Where the current voice is, in buffer seconds. AudioBufferSourceNode
 * doesn't report position, so it's derived from the context clock — this is
 * what lazy chopping cuts against.
 */
const playhead = ref(0)

/** Mute group: exactly one voice, so a new hit cuts the last. */
let voice: AudioBufferSourceNode | null = null
let voiceStartedAt = 0
let voiceOffset = 0
let voiceRate = 1
let raf: number | null = null

function trackPlayhead() {
  if (!voice || !ctx) return
  playhead.value = voiceOffset + (ctx.currentTime - voiceStartedAt) * voiceRate
  raf = requestAnimationFrame(trackPlayhead)
}

export function useSampler() {
  function stop() {
    if (raf !== null) {
      cancelAnimationFrame(raf)
      raf = null
    }
    if (voice) {
      // Cleared first so a manual stop never fires the end callback.
      voice.onended = null
      try {
        voice.stop()
      } catch {
        // already finished
      }
      voice.disconnect()
      voice = null
    }
    playing.value = null
  }

  /**
   * Frees the decoded audio — it's the largest thing the app ever holds, so
   * it doesn't survive leaving the view. The downloaded bytes do, which is
   * what makes coming back cheap.
   */
  function release() {
    stop()
    buffer.value = null
    peaks.value = null
    loadedUrl.value = null
    rate.value = 0
    progress.value = null
    error.value = null
  }

  async function load(url: string, durationSec: number) {
    if (loadedUrl.value === url && buffer.value) return
    release()

    if (durationSec > SAMPLER_MAX_SEC) {
      error.value = "Too long to load for sampling — flag the spot and cut it from the download."
      return
    }

    loading.value = true
    progress.value = 0

    try {
      const cached = byteCache.get(url)
      let bytes: ArrayBuffer

      if (cached) {
        // Already pulled this session — straight to decoding.
        bytes = cached
        progress.value = null
      } else {
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))

      const total = Number(res.headers.get('content-length')) || 0

      if (res.body && total > 0) {
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let got = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          got += value.length
          progress.value = Math.min(1, got / total)
        }
        const merged = new Uint8Array(got)
        let at = 0
        for (const c of chunks) {
          merged.set(c, at)
          at += c.length
        }
        bytes = merged.buffer
      } else {
        bytes = await res.arrayBuffer()
      }
      cacheBytes(url, bytes)
      }

      progress.value = null
      const target = decodeRateFor(durationSec)

      // decodeAudioData resamples to the context's rate, which is the whole
      // trick — the resampling happens inside the decoder rather than after.
      const Offline: typeof OfflineAudioContext =
        (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext
      let decoded: AudioBuffer
      try {
        decoded = await new Offline(1, 1, target).decodeAudioData(bytes.slice(0))
      } catch {
        // Some WebKit builds reject unusual offline rates; native is the
        // fallback and is safe for the short tracks that hit this path.
        decoded = await audioCtx().decodeAudioData(bytes.slice(0))
      }

      buffer.value = decoded
      rate.value = decoded.sampleRate
      peaks.value = toPeaks(decoded, 900)
      loadedUrl.value = url
    } catch {
      error.value = "Couldn't load this track for sampling."
      buffer.value = null
    } finally {
      loading.value = false
      progress.value = null
    }
  }

  /**
   * Plays a region. `index` is only for showing which pad is lit; `onEnd`
   * fires on natural completion, not on a manual stop.
   */
  function play(pad: Pad, index: number | null = null, onEnd?: () => void) {
    const buf = buffer.value
    if (!buf) return
    const c = audioCtx()
    if (c.state === 'suspended') void c.resume()

    stop()

    const start = Math.max(0, Math.min(pad.startSec, buf.duration))
    const span = Math.max(0.02, Math.min(pad.endSec, buf.duration) - start)

    const src = c.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = semitonesToRate(pad.pitch)
    src.connect(c.destination)
    src.onended = () => {
      if (voice === src) {
        voice = null
        playing.value = null
        if (raf !== null) {
          cancelAnimationFrame(raf)
          raf = null
        }
        onEnd?.()
      }
    }
    // Third argument is buffer time, so a pitched-up hit finishes sooner —
    // varispeed, the way a sampler's pitch control actually behaves.
    src.start(0, start, span)
    voice = src
    playing.value = index

    voiceStartedAt = c.currentTime
    voiceOffset = start
    voiceRate = src.playbackRate.value
    playhead.value = start
    raf = requestAnimationFrame(trackPlayhead)
  }

  return {
    buffer,
    peaks,
    loading,
    progress,
    error,
    rate,
    playing,
    playhead,
    load,
    play,
    stop,
    release,
  }
}
