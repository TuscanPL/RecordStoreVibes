export interface Track {
  id: string
  title: string
  duration: number | null
  streamUrl: string
}

export interface AlbumSide {
  tracks: Track[]
}

export interface Album {
  id: string
  title: string
  artist: string
  year: string | null
  genre: string
  coverArtUrl: string | null
  sides: {
    A: AlbumSide
    B: AlbumSide
  }
  sourceUrl: string
  provider: string
}

export interface AlbumDetails extends Album {
  description: string | null
}

export interface MusicProvider {
  name: string
  search(genre: string, count: number, excludeIds: string[]): Promise<Album[]>
  getAlbumDetails(id: string): Promise<AlbumDetails>
  getStreamUrl(trackId: string): Promise<string>
  getAlbumArt(id: string): Promise<string | null>
}

export const GENRES = [
  { id: 'jazz', label: 'Jazz', icon: '🎺' },
  { id: 'classical', label: 'Classical', icon: '🎻' },
  { id: 'blues', label: 'Blues', icon: '🎸' },
  { id: 'folk', label: 'Folk', icon: '🪕' },
  { id: 'world', label: 'World Music', icon: '🥁' },
  { id: 'gospel', label: 'Gospel', icon: '🎹' },
  { id: 'spoken', label: 'Spoken Word', icon: '🎙' },
  { id: 'surprise', label: 'Surprise Me', icon: '🎲' },
] as const

export type GenreId = (typeof GENRES)[number]['id']
