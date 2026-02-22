import { ref, watch, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app'

let audioContext: AudioContext | null = null
let sourceNode: AudioBufferSourceNode | null = null
let gainNode: GainNode | null = null
let currentBuffer: AudioBuffer | null = null
let startTime = 0
let pauseOffset = 0

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
  }
  return audioContext
}

export function useAudio() {
  const store = useAppStore()
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)
  const duration = ref(0)
  const bufferCache = new Map<string, AudioBuffer>()

  function getPlaybackRate(): number {
    return store.rpm === 45 ? 1.35 : 1.0
  }

  async function loadTrack(url: string): Promise<void> {
    isLoading.value = true
    loadError.value = null

    try {
      stop()

      if (bufferCache.has(url)) {
        currentBuffer = bufferCache.get(url)!
        duration.value = currentBuffer.duration
        isLoading.value = false
        return
      }

      const ctx = getAudioContext()
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`)

      const arrayBuffer = await response.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

      bufferCache.set(url, audioBuffer)
      currentBuffer = audioBuffer
      duration.value = audioBuffer.duration
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : 'Failed to load audio'
      currentBuffer = null
      duration.value = 0
    } finally {
      isLoading.value = false
    }
  }

  function play() {
    if (!currentBuffer) return

    const ctx = getAudioContext()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    stop()

    sourceNode = ctx.createBufferSource()
    sourceNode.buffer = currentBuffer
    sourceNode.playbackRate.value = getPlaybackRate()

    gainNode = ctx.createGain()
    gainNode.gain.value = 1.0

    sourceNode.connect(gainNode)
    gainNode.connect(ctx.destination)

    sourceNode.start(0, pauseOffset)
    startTime = ctx.currentTime - pauseOffset / getPlaybackRate()
    store.isPlaying = true

    sourceNode.onended = () => {
      if (store.isPlaying) {
        store.isPlaying = false
        pauseOffset = 0
        store.playbackPosition = 0
        // Auto-advance to next track
        store.nextTrack()
      }
    }
  }

  function pause() {
    if (!sourceNode || !store.isPlaying) return

    const ctx = getAudioContext()
    pauseOffset = (ctx.currentTime - startTime) * getPlaybackRate()
    store.playbackPosition = pauseOffset

    sourceNode.onended = null
    sourceNode.stop()
    sourceNode.disconnect()
    sourceNode = null
    store.isPlaying = false
  }

  function stop() {
    if (sourceNode) {
      sourceNode.onended = null
      try {
        sourceNode.stop()
      } catch {
        // already stopped
      }
      sourceNode.disconnect()
      sourceNode = null
    }
    if (gainNode) {
      gainNode.disconnect()
      gainNode = null
    }
    pauseOffset = 0
    store.isPlaying = false
  }

  function seek(position: number) {
    const wasPlaying = store.isPlaying
    if (wasPlaying) {
      pause()
    }
    pauseOffset = Math.max(0, Math.min(position, duration.value))
    store.playbackPosition = pauseOffset
    if (wasPlaying) {
      play()
    }
  }

  function seekBackward(seconds: number = 5) {
    const currentPos = getPosition()
    seek(Math.max(0, currentPos - seconds))
  }

  function seekForward(seconds: number = 5) {
    const currentPos = getPosition()
    seek(Math.min(duration.value, currentPos + seconds))
  }

  function getPosition(): number {
    if (!store.isPlaying || !audioContext) return pauseOffset
    return (audioContext.currentTime - startTime) * getPlaybackRate()
  }

  function setPlaybackRate(rate: number) {
    if (sourceNode) {
      sourceNode.playbackRate.value = rate
      if (audioContext) {
        startTime = audioContext.currentTime - pauseOffset / rate
      }
    }
  }

  // Watch RPM changes
  watch(() => store.rpm, () => {
    setPlaybackRate(getPlaybackRate())
  })

  // Watch track changes
  watch(() => store.currentTrack, async (track) => {
    if (track) {
      stop()
      pauseOffset = 0
      store.playbackPosition = 0
      await loadTrack(track.streamUrl)
    }
  })

  // Update playback position periodically
  let positionInterval: ReturnType<typeof setInterval> | null = null

  function startPositionTracking() {
    if (positionInterval) return
    positionInterval = setInterval(() => {
      if (store.isPlaying) {
        store.playbackPosition = getPosition()
      }
    }, 250)
  }

  function stopPositionTracking() {
    if (positionInterval) {
      clearInterval(positionInterval)
      positionInterval = null
    }
  }

  startPositionTracking()

  onUnmounted(() => {
    stop()
    stopPositionTracking()
  })

  return {
    isLoading,
    loadError,
    duration,
    loadTrack,
    play,
    pause,
    stop,
    seek,
    seekBackward,
    seekForward,
    getPosition,
    setPlaybackRate,
  }
}
