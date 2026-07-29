<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { provider, CRATES } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'
import { useDigSession } from '../composables/useDigSession'
import RecordRow from '../components/RecordRow.vue'

/**
 * One crate at a time. Pulling down swaps it for a deeper one rather than
 * appending — the list on screen stays finite and readable.
 */
const LIMIT = 40

const library = useLibrary()
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

async function run(key: string, call: (page: number) => Promise<any>, tag: string | null) {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  activeCrate.value = tag
  currentKey.value = key

  try {
    const listing = await call(dig.takePage(key))
    if (seq !== requestSeq) return

    dig.advance(key, listing.lastPage)
    dig.remember(listing.records.map((r: CrateRecord) => r.id))
    if (listing.drained) dig.markDrained(key)

    records.value = listing.records
    totalFound.value = listing.totalFound
    label.value = listing.label
    drained.value = listing.drained && listing.records.length === 0
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

function openCrate(crate: { id: string; query: string }) {
  query.value = ''
  run(
    `crate:${crate.id}`,
    page => provider.browseQuery(crate.query, { limit: LIMIT, page, exclude: dig.seen }),
    crate.id,
  )
}

function runSearch() {
  const q = query.value.trim()
  if (!q) return
  run(`q:${q.toLowerCase()}`, page => provider.search(q, { limit: LIMIT, page, exclude: dig.seen }), null)
}

/** Same query, next page, nothing already seen. */
function digDeeper() {
  if (loading.value || !currentKey.value) return
  const crate = CRATES.find(c => c.id === activeCrate.value)
  if (crate) openCrate(crate)
  else if (query.value.trim()) runSearch()
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

onMounted(() => openCrate(CRATES[0]!))
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex-none px-4 pt-safe pb-2 flex items-baseline justify-between">
      <h1 class="font-display text-2xl text-cream">Crate</h1>
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

      <form class="px-3 pb-3" @submit.prevent="runSearch">
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
