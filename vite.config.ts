import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Writes the built filenames into the service worker.
 *
 * Runtime caching alone isn't enough: on a first visit the worker isn't
 * controlling the page yet, so the document and its hashed assets are
 * fetched before it can see them. Going offline at that point would leave
 * nothing cached. Precaching means one online visit is genuinely enough.
 */
function serviceWorkerPrecache(): Plugin {
  let base = '/'
  let outDir = 'dist'

  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(config) {
      base = config.base
      outDir = config.build.outDir
    },
    closeBundle() {
      const swFile = join(outDir, 'sw.js')
      let source: string
      try {
        source = readFileSync(swFile, 'utf8')
      } catch {
        return
      }

      const assets = readdirSync(join(outDir, 'assets')).map(f => `${base}assets/${f}`)
      const files = [base, `${base}manifest.webmanifest`, ...assets]

      // Cache name carries the asset hashes, so a deploy supersedes the old
      // shell instead of leaving a half-updated mixture behind.
      const stamp = assets
        .map(a => a.slice(a.lastIndexOf('-') + 1, a.lastIndexOf('.')))
        .join('')
        .slice(0, 16)

      writeFileSync(
        swFile,
        source
          .replace('/*__PRECACHE__*/', files.map(f => JSON.stringify(f)).join(', '))
          .replace('__STAMP__', stamp || 'dev'),
      )
    },
  }
}

export default defineConfig({
  base: '/RecordStoreVibes/',
  plugins: [vue(), serviceWorkerPrecache()],
})
