import { ref, computed, readonly } from 'vue'
import type { Record as CrateRecord, Track } from '../providers/types'

/**
 * One element for the whole app, living outside any component so playback
 * survives navigation between screens.
 *
 * Deliberately an <audio> element rather than the Web Audio API: this app
 * streams long files over cellular and needs lock screen transport, and
 * decodeAudioData would require the whole file in memory before a note
 * sounds. No pitch or rate manipulation is in scope, so there is nothing
 * to trade away.
 */
let el: HTMLAudioElement | null = null

const currentRecord = ref<CrateRecord | null>(null)
const currentTrack = ref<Track | null>(null)
const isPlaying = ref(false)
const isLoading = ref(false)
const error = ref<string | null>(null)
const position = ref(0)
const duration = ref(0)

function element(): HTMLAudioElement {
  if (el) return el

  el = new Audio()
  el.preload = 'metadata'
  // No crossOrigin: plain playback doesn't need CORS, and asking for it
  // turns any missing header on archive.org into a hard failure.

  el.addEventListener('playing', () => {
    isPlaying.value = true
    isLoading.value = false
    error.value = null
  })
  el.addEventListener('pause', () => {
    isPlaying.value = false
  })
  el.addEventListener('waiting', () => {
    isLoading.value = true
  })
  el.addEventListener('canplay', () => {
    isLoading.value = false
  })
  el.addEventListener('timeupdate', () => {
    position.value = el!.currentTime
  })
  el.addEventListener('durationchange', () => {
    duration.value = Number.isFinite(el!.duration) ? el!.duration : 0
  })
  el.addEventListener('error', () => {
    isLoading.value = false
    isPlaying.value = false
    error.value = "Couldn't play this file — archive.org may not have a streamable copy."
  })
  el.addEventListener('ended', () => {
    // A record finishes. Nothing plays next, by design.
    isPlaying.value = false
    position.value = 0
  })

  return el
}

function syncMediaSession() {
  if (!('mediaSession' in navigator)) return
  const record = currentRecord.value
  const track = currentTrack.value
  if (!record || !track) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: record.creator,
    album: record.title,
    artwork: record.artworkUrl ? [{ src: record.artworkUrl, sizes: '512x512' }] : [],
  })

  const set = (action: MediaSessionAction, handler: (() => void) | null) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler)
    } catch {
      // Not every browser supports every action.
    }
  }

  set('play', () => void play())
  set('pause', () => pause())
  set('seekbackward', () => nudge(-10))
  set('seekforward', () => nudge(10))
  // nexttrack / previoustrack are intentionally left unset — there is no
  // queue to advance into.
  set('nexttrack', null)
  set('previoustrack', null)
}

async function load(record: CrateRecord, track: Track, autoplay = true) {
  const audio = element()
  const changed = currentTrack.value?.streamUrl !== track.streamUrl

  currentRecord.value = record
  currentTrack.value = track

  if (changed) {
    error.value = null
    isLoading.value = true
    position.value = 0
    duration.value = track.durationSec ?? 0
    audio.src = track.streamUrl
    audio.load()
  }

  syncMediaSession()
  if (autoplay) await play()
}

async function play() {
  const audio = element()
  if (!audio.src) return
  try {
    await audio.play()
  } catch {
    // Typically an autoplay-policy rejection; the user taps again.
    isPlaying.value = false
    isLoading.value = false
  }
}

function pause() {
  element().pause()
}

async function toggle() {
  if (isPlaying.value) pause()
  else await play()
}

function seek(seconds: number) {
  const audio = element()
  const max = Number.isFinite(audio.duration) ? audio.duration : seconds
  audio.currentTime = Math.min(Math.max(0, seconds), max)
  position.value = audio.currentTime
}

function nudge(delta: number) {
  seek((element().currentTime || 0) + delta)
}

function stop() {
  const audio = element()
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  currentRecord.value = null
  currentTrack.value = null
  isPlaying.value = false
  position.value = 0
  duration.value = 0
}

export function useAudio() {
  return {
    currentRecord: readonly(currentRecord),
    currentTrack: readonly(currentTrack),
    isPlaying: readonly(isPlaying),
    isLoading: readonly(isLoading),
    error: readonly(error),
    position: readonly(position),
    duration: readonly(duration),
    /** Falls back to the item's declared length before metadata lands. */
    effectiveDuration: computed(
      () => duration.value || currentTrack.value?.durationSec || 0,
    ),
    load,
    play,
    pause,
    toggle,
    seek,
    nudge,
    stop,
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
