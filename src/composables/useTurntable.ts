import { computed } from 'vue'
import { useAppStore } from '../stores/app'
import { useAudio } from './useAudio'

export function useTurntable() {
  const store = useAppStore()
  const audio = useAudio()

  const rotationSpeed = computed(() => {
    if (!store.isPlaying) return 0
    return store.rpm === 33 ? 1.0 : 1.35
  })

  const currentSideTracks = computed(() => {
    if (!store.activeRecord) return []
    return store.activeRecord.sides[store.currentSide].tracks
  })

  const hasNextTrack = computed(() => {
    return store.currentTrackIndex < currentSideTracks.value.length - 1
  })

  const hasPreviousTrack = computed(() => {
    return store.currentTrackIndex > 0
  })

  const hasSideB = computed(() => {
    if (!store.activeRecord) return false
    return store.activeRecord.sides.B.tracks.length > 0
  })

  function togglePlayPause() {
    if (store.isPlaying) {
      audio.pause()
    } else {
      if (store.currentTrack) {
        if (audio.duration.value > 0) {
          audio.play()
        } else {
          audio.loadTrack(store.currentTrack.streamUrl).then(() => {
            audio.play()
          })
        }
      }
    }
  }

  function placeRecord(album: typeof store.activeRecord) {
    if (!album) return
    store.setActiveRecord(album)
  }

  function flipRecord() {
    const wasPlaying = store.isPlaying
    if (wasPlaying) {
      audio.stop()
    }
    store.flipSide()
  }

  function nextTrack() {
    if (!hasNextTrack.value) return
    audio.stop()
    store.nextTrack()
  }

  function previousTrack() {
    if (!hasPreviousTrack.value) return
    audio.stop()
    store.previousTrack()
  }

  function rewind() {
    audio.seekBackward(5)
  }

  function fastForward() {
    audio.seekForward(5)
  }

  return {
    audio,
    rotationSpeed,
    currentSideTracks,
    hasNextTrack,
    hasPreviousTrack,
    hasSideB,
    togglePlayPause,
    placeRecord,
    flipRecord,
    nextTrack,
    previousTrack,
    rewind,
    fastForward,
  }
}
