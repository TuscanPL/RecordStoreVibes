<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

/**
 * Installed launches never land here — the manifest's start_url points
 * straight at /browse. This is only a backstop for anyone who saved the
 * bare URL before that existed.
 */
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

const isIOS = ref(false)
const canPrompt = ref(false)
let deferredPrompt: (Event & { prompt: () => Promise<void> }) | null = null

onMounted(() => {
  if (isStandalone()) {
    router.replace('/browse')
    return
  }
  isIOS.value = /iphone|ipad|ipod/i.test(navigator.userAgent)

  // Android fires this and lets us show a real button; iOS never does.
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredPrompt = e as Event & { prompt: () => Promise<void> }
    canPrompt.value = true
  })
})

async function install() {
  if (!deferredPrompt) return
  await deferredPrompt.prompt()
  deferredPrompt = null
  canPrompt.value = false
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="min-h-full max-w-md mx-auto px-6 pt-safe pb-10 flex flex-col">
      <header class="pt-10">
        <div class="flex items-center gap-3">
          <svg class="w-9 h-9 flex-none" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="12" fill="none" stroke="#d99a4e" stroke-width="1.5" />
            <circle cx="16" cy="16" r="7" fill="none" stroke="#8a7454" stroke-width="1" />
            <circle cx="16" cy="16" r="2.5" fill="#d99a4e" />
          </svg>
          <h1 class="font-display text-3xl text-cream">CrateSampler</h1>
        </div>
        <p class="text-[15px] text-flag-soft mt-3 leading-relaxed">
          Dig for samples on your phone. Flag the good bits while you listen,
          chop them into pads, take the pieces away as WAVs.
        </p>
      </header>

      <!-- The page's actual job. It's only any good on a home screen. -->
      <section class="mt-8 rounded-xl border border-ink-600 bg-ink-800/60 p-4">
        <p class="text-[11px] uppercase tracking-wider text-flag-dim mb-3">
          Put it on your home screen
        </p>

        <button
          v-if="canPrompt"
          class="w-full h-12 rounded-lg bg-flag text-ink-900 text-[15px] font-semibold
                 active:scale-[0.99] transition-transform"
          @click="install"
        >
          Install
        </button>

        <ol v-else-if="isIOS" class="text-[14px] text-cream/90 space-y-2 leading-relaxed">
          <li class="flex gap-2">
            <span class="text-flag-dim tabular-nums">1.</span>
            <span>
              Tap
              <svg class="inline w-4 h-4 -mt-0.5 mx-0.5" fill="none" stroke="currentColor"
                   stroke-width="1.7" viewBox="0 0 24 24" aria-label="Share">
                <path d="M12 16V4m0 0L8 8m4-4l4 4" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M5 14v5a1 1 0 001 1h12a1 1 0 001-1v-5" stroke-linecap="round" />
              </svg>
              Share, at the bottom of Safari
            </span>
          </li>
          <li class="flex gap-2">
            <span class="text-flag-dim tabular-nums">2.</span>
            <span>Scroll down, tap <em class="not-italic text-flag">Add to Home Screen</em></span>
          </li>
          <li class="flex gap-2">
            <span class="text-flag-dim tabular-nums">3.</span>
            <span>Open it from there, not from Safari</span>
          </li>
        </ol>

        <p v-else class="text-[14px] text-cream/90 leading-relaxed">
          Open your browser menu and pick <em class="not-italic text-flag">Install</em> or
          <em class="not-italic text-flag">Add to Home Screen</em>. It's built for a phone,
          but it runs on a desktop if you want a poke around first.
        </p>

        <router-link
          to="/browse"
          class="block text-center text-[13px] text-flag-dim mt-4 underline underline-offset-4
                 active:text-cream"
        >
          or just open it in the browser →
        </router-link>
      </section>

      <section class="mt-8">
        <p class="text-[11px] uppercase tracking-wider text-flag-dim mb-3">
          Two rules it sticks to
        </p>
        <div class="space-y-4">
          <div>
            <p class="text-[15px] text-cream">One thumb, eyes half-engaged.</p>
            <p class="text-[13px] text-flag-dim leading-relaxed mt-1">
              It's for the gaps in a day — a meal, a bus, ten minutes between
              things. If a screen needs two hands and your full attention, it
              doesn't belong in here.
            </p>
          </div>
          <div>
            <p class="text-[15px] text-cream">It has to end.</p>
            <p class="text-[13px] text-flag-dim leading-relaxed mt-1">
              No infinite feed, no autoplay next, nothing recommended at you.
              A record finishes and you're done. That's the whole point — it's
              meant to replace the thing that doesn't let you stop.
            </p>
          </div>
        </div>
      </section>

      <section class="mt-8 text-[13px] text-flag-dim leading-relaxed space-y-3">
        <p>
          It digs the Internet Archive, and takes whatever you bring it — a
          link straight to an audio file, or a file off your own device. More
          libraries on the way. Everything you flag keeps a tag saying where
          it came from, and that travels into the export — so you always know
          what you're holding. What you do with it after that is yours to
          work out.
        </p>
        <p>
          Nothing leaves your phone. Flags, chops and downloads all live on the
          device, and it works with no signal once a track is pulled down.
        </p>
      </section>

      <footer class="mt-auto pt-10 flex items-center justify-between text-[12px]">
        <a
          href="https://github.com/TuscanPL/RecordStoreVibes"
          target="_blank"
          rel="noopener"
          class="text-flag-dim underline underline-offset-4 active:text-cream"
        >
          source
        </a>
        <a
          href="https://twitter.com/tuscanfgc"
          target="_blank"
          rel="noopener"
          class="text-ink-500 active:text-cream"
        >
          made this for myself · <span class="text-flag-dim">@tuscanfgc</span>
        </a>
      </footer>
    </div>
  </div>
</template>
