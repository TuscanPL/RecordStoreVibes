/*
 * Offline shell for the home-screen app on iOS and Android.
 *
 * The file list and cache name are filled in at build time by the
 * sw-precache plugin — the placeholders below are valid JS so this still
 * parses when served straight from public/ during dev.
 *
 * Audio is deliberately not handled here. The sampler writes downloads into
 * its own cache, where it can budget and evict them by size.
 */
const SHELL = 'crate-shell-__STAMP__'
const AUDIO = 'crate-audio-v1'
const PRECACHE = [/*__PRECACHE__*/]

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      if (PRECACHE.length === 0) return
      const cache = await caches.open(SHELL)
      // Individually, so one bad URL can't fail the whole install.
      await Promise.all(
        PRECACHE.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      )
    })(),
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      // Old shells go; the audio cache is left alone, it isn't versioned.
      await Promise.all(
        keys.filter(k => k !== SHELL && k !== AUDIO).map(k => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

async function cacheFirst(request) {
  const cache = await caches.open(SHELL)
  // ignoreVary: the precache stores one entry per URL, but a stylesheet and
  // a script request carry different Accept headers. With Vary honoured
  // those miss, and the asset is refetched — fatal with no network.
  const hit = await cache.match(request, { ignoreVary: true })
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function documentResponse(request) {
  const cache = await caches.open(SHELL)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    // Hash routing means every route is the same document, so the precached
    // shell answers for any of them.
    const opts = { ignoreVary: true, ignoreSearch: true }
    const hit =
      (await cache.match(request, opts)) ||
      (await cache.match(PRECACHE[0] || './', opts)) ||
      (await cache.match('./index.html', opts))
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // The document is network-first so a deploy is picked up on the next
  // launch; hashed assets are cache-first because their names change when
  // their contents do.
  event.respondWith(
    request.mode === 'navigate' ? documentResponse(request) : cacheFirst(request),
  )
})
