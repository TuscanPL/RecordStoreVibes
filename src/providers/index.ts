import type { MusicProvider } from './types'
import { InternetArchiveProvider } from './internet-archive'

const providers: Map<string, MusicProvider> = new Map()

export function registerProvider(provider: MusicProvider) {
  providers.set(provider.name, provider)
}

export function getProvider(name?: string): MusicProvider {
  if (name) {
    const p = providers.get(name)
    if (p) return p
  }
  const first = providers.values().next()
  if (first.done) throw new Error('No music providers registered')
  return first.value
}

registerProvider(new InternetArchiveProvider())

export { type MusicProvider } from './types'
