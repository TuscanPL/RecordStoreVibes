import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Album } from '../providers/types'

export type Scene = 'genre-select' | 'crate-browse' | 'turntable'

export const useAppStore = defineStore('app', () => {
  // Flow state
  const currentScene = ref<Scene>('genre-select')
  const selectedGenre = ref<string | null>(null)
  const isTransitioning = ref(false)

  // Crate state
  const currentCrate = ref<Album[]>([])
  const seenAlbumIds = ref<Set<string>>(new Set())
  const selectedRecords = ref<Album[]>([])
  const isLoadingCrate = ref(false)
  const crateRequestCount = ref(0)

  // Turntable state
  const activeRecord = ref<Album | null>(null)
  const currentSide = ref<'A' | 'B'>('A')
  const currentTrackIndex = ref(0)
  const isPlaying = ref(false)
  const rpm = ref<33 | 45>(33)
  const playbackPosition = ref(0)

  // Computed
  const maxRecords = 5
  const remainingPicks = computed(() => maxRecords - selectedRecords.value.length)
  const canSelectMore = computed(() => selectedRecords.value.length < maxRecords)
  const canLeaveStore = computed(() => selectedRecords.value.length > 0)

  const currentTrack = computed(() => {
    if (!activeRecord.value) return null
    const side = activeRecord.value.sides[currentSide.value]
    return side.tracks[currentTrackIndex.value] || null
  })

  // Actions
  function selectGenre(genre: string) {
    selectedGenre.value = genre
    seenAlbumIds.value.clear()
    selectedRecords.value = []
    crateRequestCount.value = 0
    currentScene.value = 'crate-browse'
  }

  function setCrate(albums: Album[]) {
    currentCrate.value = albums
    for (const a of albums) {
      seenAlbumIds.value.add(a.id)
    }
    crateRequestCount.value++
  }

  function selectRecord(album: Album) {
    if (!canSelectMore.value) return
    if (selectedRecords.value.find(r => r.id === album.id)) return
    selectedRecords.value.push(album)
  }

  function deselectRecord(albumId: string) {
    selectedRecords.value = selectedRecords.value.filter(r => r.id !== albumId)
  }

  function isRecordSelected(albumId: string): boolean {
    return selectedRecords.value.some(r => r.id === albumId)
  }

  function goToTurntable() {
    if (!canLeaveStore.value) return
    activeRecord.value = selectedRecords.value[0] ?? null
    currentSide.value = 'A'
    currentTrackIndex.value = 0
    isPlaying.value = false
    playbackPosition.value = 0
    currentScene.value = 'turntable'
  }

  function setActiveRecord(album: Album) {
    activeRecord.value = album
    currentSide.value = 'A'
    currentTrackIndex.value = 0
    isPlaying.value = false
    playbackPosition.value = 0
  }

  function flipSide() {
    currentSide.value = currentSide.value === 'A' ? 'B' : 'A'
    currentTrackIndex.value = 0
    playbackPosition.value = 0
  }

  function toggleRpm() {
    rpm.value = rpm.value === 33 ? 45 : 33
  }

  function nextTrack() {
    if (!activeRecord.value) return
    const side = activeRecord.value.sides[currentSide.value]
    if (currentTrackIndex.value < side.tracks.length - 1) {
      currentTrackIndex.value++
      playbackPosition.value = 0
    }
  }

  function previousTrack() {
    if (currentTrackIndex.value > 0) {
      currentTrackIndex.value--
      playbackPosition.value = 0
    }
  }

  function resetToGenreSelect() {
    currentScene.value = 'genre-select'
    selectedGenre.value = null
    currentCrate.value = []
    seenAlbumIds.value.clear()
    selectedRecords.value = []
    activeRecord.value = null
    isPlaying.value = false
    playbackPosition.value = 0
    crateRequestCount.value = 0
  }

  return {
    // State
    currentScene,
    selectedGenre,
    isTransitioning,
    currentCrate,
    seenAlbumIds,
    selectedRecords,
    isLoadingCrate,
    crateRequestCount,
    activeRecord,
    currentSide,
    currentTrackIndex,
    isPlaying,
    rpm,
    playbackPosition,

    // Computed
    maxRecords,
    remainingPicks,
    canSelectMore,
    canLeaveStore,
    currentTrack,

    // Actions
    selectGenre,
    setCrate,
    selectRecord,
    deselectRecord,
    isRecordSelected,
    goToTurntable,
    setActiveRecord,
    flipSide,
    toggleRpm,
    nextTrack,
    previousTrack,
    resetToGenreSelect,
  }
})
