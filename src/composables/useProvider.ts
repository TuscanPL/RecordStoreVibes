import { ref } from 'vue'
import { useAppStore } from '../stores/app'
import { getProvider } from '../providers'
export function useProvider() {
  const store = useAppStore()
  const provider = getProvider()
  const error = ref<string | null>(null)

  async function loadCrate(genre: string): Promise<void> {
    store.isLoadingCrate = true
    error.value = null

    try {
      const excludeIds = Array.from(store.seenAlbumIds)
      const albums = await provider.search(genre, 20, excludeIds)

      if (albums.length === 0) {
        error.value = 'No records found. The clerk shrugs apologetically.'
        return
      }

      store.setCrate(albums)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load records'
    } finally {
      store.isLoadingCrate = false
    }
  }

  async function askTheClerk(): Promise<void> {
    if (!store.selectedGenre) return
    await loadCrate(store.selectedGenre)
  }

  async function getAlbumDetails(id: string) {
    try {
      return await provider.getAlbumDetails(id)
    } catch {
      return null
    }
  }

  return {
    provider,
    error,
    loadCrate,
    askTheClerk,
    getAlbumDetails,
  }
}
