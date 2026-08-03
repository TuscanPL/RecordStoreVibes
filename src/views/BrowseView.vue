<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { provider, CRATES } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { useDigSession, type CachedView } from '../composables/useDigSession'
import RecordRow from '../components/RecordRow.vue'

/**
 * One crate at a time. Pulling down swaps it for a deeper one rather than
 * appending — the list on screen stays finite and readable.
 */
const LIMIT = 40

const library = useLibrary()

/**
 * Which build is actually running, and what the window really measures.
 *
 * A service worker can serve a stale build for a long time, which makes a
 * fix that never arrived look exactly like a fix that didn't work. Tapping
 * the version shows the geometry behind the standalone chin, straight from
 * the device rather than inferred from a screenshot.
 */
const buildId = __BUILD_ID__
const showDiag = ref(false)
const diag = ref('')

function readDiag() {
  const app = document.getElementById('app')
  const rect = app?.getBoundingClientRect()
  const measure = (side: 'top' | 'bottom') => {
    const probe = document.createElement('div')
    probe.style.cssText =
      `position:fixed;${side}:0;height:env(safe-area-inset-${side},0px);width:0`
    document.body.appendChild(probe)
    const px = Math.round(probe.getBoundingClientRect().height)
    probe.remove()
    return px
  }
  const safeTop = measure('top')
  const safeBottom = measure('bottom')

  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true

  diag.value = [
    `win ${Math.round(window.innerHeight)}`,
    `app ${Math.round(rect?.height ?? 0)}`,
    `scr ${Math.round(window.screen.height)}`,
    `safe ${safeTop}/${safeBottom}`,
    standalone ? 'standalone' : 'browser',
  ].join(' · ')
}

function toggleDiag() {
  showDiag.value = !showDiag.value
  if (showDiag.value) readDiag()
}
const dig = useDigSession()
const records = ref<CrateRecord[]>([])
const totalFound = ref(0)
const label = ref('')
const activeCrate = ref<string | null>(null)
const query = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

let debounce: ReturnType<typeof setTimeout> | null = null
/** Guards against a slow early request overwriting a newer one. */
let requestSeq = 0

/** Anything already proven unplayable stays out of sight. */
const visible = computed(() => records.value.filter(r => !library.isUnplayable(r.id)))

/** Identifies the current query in the session's page bookkeeping. */
const currentKey = ref<string>('')
const drained = ref(false)

/**
 * @param filtered Only true for a pull-to-dig. A plain load takes page 1 as
 *   it comes; excluding what's been seen and paging deeper is what the pull
 *   gesture is for, and doing it on every visit would burn through the
 *   archive just by navigating around.
 */
async function run(
  key: string,
  call: (page: number, exclude?: ReadonlySet<string>) => Promise<any>,
  tag: string | null,
  filtered: boolean,
) {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  activeCrate.value = tag
  currentKey.value = key

  try {
    const listing = filtered
      ? await call(dig.takePage(key), dig.seen)
      : await call(1, undefined)
    if (seq !== requestSeq) return

    dig.advance(key, listing.lastPage)
    // Remembered either way — that's what makes the next pull find new material.
    dig.remember(listing.records.map((r: CrateRecord) => r.id))
    if (listing.drained) dig.markDrained(key)

    records.value = listing.records
    totalFound.value = listing.totalFound
    label.value = listing.label
    drained.value = listing.drained && listing.records.length === 0

    dig.cacheView({
      key,
      tag,
      query: query.value,
      label: label.value,
      records: listing.records,
      totalFound: listing.totalFound,
      drained: drained.value,
      scrollTop: 0,
    })
    if (listEl.value) listEl.value.scrollTop = 0
  } catch (e) {
    if (seq !== requestSeq) return
    records.value = []
    totalFound.value = 0
    error.value =
      e instanceof Error && e.name === 'AbortError'
        ? 'archive.org took too long. Try again.'
        : "Couldn't reach archive.org."
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function show(view: CachedView) {
  activeCrate.value = view.tag
  currentKey.value = view.key
  // Whatever you're looking at is what you should come back to.
  dig.setLast(view.key)
  query.value = view.query
  label.value = view.label
  records.value = view.records
  totalFound.value = view.totalFound
  drained.value = view.drained
  error.value = null
  restoreScroll(view.scrollTop)
}

/**
 * Rows aren't laid out yet on the first tick, so assigning scrollTop there
 * clamps against a content height that's still growing. Reapply for a few
 * frames until it sticks.
 */
function restoreScroll(top: number) {
  if (top <= 0) return
  let tries = 0
  const apply = () => {
    const el = listEl.value
    if (!el) return
    el.scrollTop = top
    if (Math.abs(el.scrollTop - top) > 1 && tries++ < 8) requestAnimationFrame(apply)
  }
  nextTick(() => requestAnimationFrame(apply))
}

function fetchCrate(crate: { id: string; query: string }, filtered: boolean) {
  run(
    `crate:${crate.id}`,
    (page, exclude) => provider.browseQuery(crate.query, { limit: LIMIT, page, exclude }),
    crate.id,
    filtered,
  )
}

/** Selecting a crate shows what's already there rather than spending a fetch. */
function openCrate(crate: { id: string; query: string }) {
  query.value = ''
  const cached = dig.getView(`crate:${crate.id}`)
  if (cached) {
    show(cached)
    return
  }
  fetchCrate(crate, false)
}

function runSearch(filtered = false) {
  const q = query.value.trim()
  if (!q) return
  const key = `q:${q.toLowerCase()}`
  if (!filtered) {
    const cached = dig.getView(key)
    if (cached) {
      show(cached)
      return
    }
  }
  run(
    key,
    (page, exclude) => provider.search(q, { limit: LIMIT, page, exclude }),
    null,
    filtered,
  )
}

/** The only path that pages deeper and drops what's already been seen. */
function digDeeper() {
  if (loading.value || !currentKey.value) return
  const crate = CRATES.find(c => c.id === activeCrate.value)
  if (crate) fetchCrate(crate, true)
  else if (query.value.trim()) runSearch(true)
}

/** Debounced: IA answers repeated hammering with escalating IP bans. */
function onType() {
  if (debounce) clearTimeout(debounce)
  const q = query.value.trim()
  if (q.length < 3) return
  debounce = setTimeout(runSearch, 450)
}

/* ---- pull to dig ---- */

const PULL_TRIGGER = 68
const PULL_MAX = 108
/** Drag feels heavier than it moves, so a deliberate pull is needed. */
const RESISTANCE = 0.55

const listEl = ref<HTMLElement | null>(null)
const pull = ref(0)
let pullFrom: number | null = null

function onTouchStart(e: TouchEvent) {
  if (loading.value || !listEl.value || listEl.value.scrollTop > 0) return
  pullFrom = e.touches[0]?.clientY ?? null
}

function onTouchMove(e: TouchEvent) {
  if (pullFrom === null) return
  const y = e.touches[0]?.clientY ?? 0
  const dy = y - pullFrom

  // Scrolling up, or the list scrolled away from the top: hand it back.
  if (dy <= 0 || (listEl.value && listEl.value.scrollTop > 0)) {
    pullFrom = null
    pull.value = 0
    return
  }

  // Non-passive so this actually suppresses the browser's own overscroll.
  e.preventDefault()
  pull.value = Math.min(PULL_MAX, dy * RESISTANCE)
}

function onTouchEnd() {
  if (pullFrom === null) return
  const shouldDig = pull.value >= PULL_TRIGGER
  pullFrom = null
  pull.value = 0
  if (shouldDig) digDeeper()
}

const pullReady = computed(() => pull.value >= PULL_TRIGGER)

onMounted(() => {
  // Coming back from a record restores exactly what was on screen, scroll
  // included — no fetch, and no pages spent just for navigating.
  const last = dig.lastView()
  if (last) show(last)
  else fetchCrate(CRATES[0]!, false)
})

function stashScroll() {
  if (currentKey.value && listEl.value) {
    dig.rememberScroll(currentKey.value, listEl.value.scrollTop)
  }
}

// Unmount fires on the way into a record, which is exactly when to save it.
onBeforeUnmount(stashScroll)
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex-none px-4 pt-safe pb-2 flex items-baseline justify-between">
      <h1 class="font-display text-2xl text-cream">
        Crate<button
          class="align-super text-[9px] font-body tabular-nums text-ink-600 ml-1"
          :aria-label="`Build ${buildId}`"
          @click="toggleDiag"
        >{{ buildId }}</button>
      </h1>
      <p class="text-[11px] text-flag-dim tabular-nums">
        <span v-if="loading">digging…</span>
        <span v-else-if="visible.length">
          {{ visible.length }} records
          <span v-if="dig.seenCount.value > visible.length" class="text-ink-500">
            · {{ dig.seenCount.value }} seen
          </span>
        </span>
      </p>
    </header>

    <p
      v-if="showDiag"
      class="flex-none px-4 pb-1 text-[10px] tabular-nums text-ink-500"
      @click="readDiag"
    >
      {{ diag }}
    </p>

    <!-- Results fill the screen; everything you tap is below. -->
    <div class="flex-1 min-h-0 relative overflow-hidden">
      <!-- Revealed by the pull itself, so it can't be mistaken for a spinner. -->
      <div
        class="absolute inset-x-0 top-0 flex items-end justify-center pb-1 pointer-events-none"
        :style="{ height: `${pull}px`, opacity: pull > 6 ? 1 : 0 }"
      >
        <span
          class="text-[11px] uppercase tracking-wider transition-colors"
          :class="pullReady ? 'text-flag' : 'text-flag-dim'"
        >
          {{ pullReady ? 'Release to dig' : 'Pull to dig deeper' }}
        </span>
      </div>

      <div
        ref="listEl"
        class="h-full scroll-y"
        :class="pull > 0 ? '' : 'transition-transform duration-200'"
        :style="{ transform: `translateY(${pull}px)` }"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
      <p v-if="error" class="px-4 py-6 text-[14px] text-red-300/80">{{ error }}</p>

      <div v-else-if="loading && !visible.length" class="px-4 py-10 text-center">
        <p class="text-[13px] text-flag-dim">Digging…</p>
      </div>

      <p
        v-else-if="!visible.length"
        class="px-6 py-10 text-center text-[14px] text-flag-dim leading-relaxed"
      >
        <template v-if="drained">
          You've been through this whole crate.
          <br />
          <span class="text-[13px] text-ink-500">Try another, or search for something.</span>
        </template>
        <template v-else>Nothing here. Try another crate or a different search.</template>
      </p>

      <template v-else>
        <RecordRow v-for="r in visible" :key="r.id" :record="r" />
        <p class="px-4 py-6 text-center text-[12px] text-ink-500">
          That's the crate — {{ visible.length }} of
          {{ totalFound.toLocaleString() }} matches.
          <br />
          <span class="text-[11px]">Pull down for a deeper batch you haven't seen.</span>
        </p>
      </template>
      </div>
    </div>

    <!-- Controls live in the bottom third, within thumb reach. -->
    <div class="flex-none border-t border-ink-700 bg-ink-800">
      <div class="flex gap-2 px-3 py-2.5 overflow-x-auto no-bar">
        <button
          v-for="c in CRATES"
          :key="c.id"
          class="flex-none px-3.5 h-9 rounded-full text-[13px] border transition-colors"
          :class="
            activeCrate === c.id
              ? 'bg-flag text-ink-900 border-flag font-medium'
              : 'text-flag-soft border-ink-500 active:bg-ink-700'
          "
          @click="openCrate(c)"
        >
          {{ c.label }}
        </button>
      </div>

      <!-- Called with no args: the submit Event would otherwise arrive as
           `filtered` and turn a plain search into a dig. -->
      <form class="px-3 pb-3" @submit.prevent="runSearch()">
        <input
          v-model="query"
          type="search"
          inputmode="search"
          enterkeyhint="search"
          placeholder="Search archive.org…"
          class="w-full h-11 px-4 rounded-lg bg-ink-700 text-cream text-[15px]
                 placeholder:text-ink-500 border border-ink-600
                 focus:outline-none focus:border-flag-dim"
          @input="onType"
        />
      </form>
    </div>
  </div>
</template>
