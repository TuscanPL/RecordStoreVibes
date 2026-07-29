<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { provider, COLLECTIONS } from '../providers'
import type { Record as CrateRecord } from '../providers/types'
import RecordRow from '../components/RecordRow.vue'

/** Hard cap. There is no "load more" and there will not be one. */
const LIMIT = 40

const records = ref<CrateRecord[]>([])
const totalFound = ref(0)
const label = ref('')
const activeCollection = ref<string | null>(null)
const query = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

let debounce: ReturnType<typeof setTimeout> | null = null
/** Guards against a slow early request overwriting a newer one. */
let requestSeq = 0

async function run(fn: () => Promise<any>, tag: string | null) {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  activeCollection.value = tag
  try {
    const listing = await fn()
    if (seq !== requestSeq) return
    records.value = listing.records
    totalFound.value = listing.totalFound
    label.value = listing.label
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

function openCollection(id: string) {
  query.value = ''
  run(() => provider.browseCollection(id, LIMIT), id)
}

function runSearch() {
  const q = query.value.trim()
  if (!q) return
  run(() => provider.search(q, LIMIT), null)
}

/** Debounced: IA answers repeated hammering with escalating IP bans. */
function onType() {
  if (debounce) clearTimeout(debounce)
  const q = query.value.trim()
  if (q.length < 3) return
  debounce = setTimeout(runSearch, 450)
}

onMounted(() => openCollection(COLLECTIONS[0].id))
</script>

<template>
  <div class="h-full flex flex-col">
    <header class="flex-none px-4 pt-safe pb-2 flex items-baseline justify-between">
      <h1 class="font-display text-2xl text-cream">Crate</h1>
      <p class="text-[11px] text-flag-dim tabular-nums">
        <span v-if="loading">searching…</span>
        <span v-else-if="records.length">{{ records.length }} records</span>
      </p>
    </header>

    <!-- Results fill the screen; everything you tap is below. -->
    <div class="flex-1 min-h-0 scroll-y">
      <p v-if="error" class="px-4 py-6 text-[14px] text-red-300/80">{{ error }}</p>

      <div v-else-if="loading && !records.length" class="px-4 py-10 text-center">
        <p class="text-[13px] text-flag-dim">Digging…</p>
      </div>

      <p
        v-else-if="!records.length"
        class="px-6 py-10 text-center text-[14px] text-flag-dim leading-relaxed"
      >
        Nothing here. Try another crate or a different search.
      </p>

      <template v-else>
        <RecordRow v-for="r in records" :key="r.id" :record="r" />
        <p class="px-4 py-6 text-center text-[12px] text-ink-500">
          That's the crate — {{ records.length }} of
          {{ totalFound.toLocaleString() }} matches.
          <br />
          <span class="text-[11px]">Search or switch crates for different ones.</span>
        </p>
      </template>
    </div>

    <!-- Controls live in the bottom third, within thumb reach. -->
    <div class="flex-none border-t border-ink-700 bg-ink-800">
      <div class="flex gap-2 px-3 py-2.5 overflow-x-auto no-bar">
        <button
          v-for="c in COLLECTIONS"
          :key="c.id"
          class="flex-none px-3.5 h-9 rounded-full text-[13px] border transition-colors"
          :class="
            activeCollection === c.id
              ? 'bg-flag text-ink-900 border-flag font-medium'
              : 'text-flag-soft border-ink-500 active:bg-ink-700'
          "
          @click="openCollection(c.id)"
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
