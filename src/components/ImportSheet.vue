<script setup lang="ts">
import { ref } from 'vue'
import { useLibrary } from '../stores/library'
import { ingestFile, ingestLink, ImportError } from '../providers/local'

const emit = defineEmits<{ close: []; added: [] }>()
const library = useLibrary()

const url = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)

/**
 * Probing a source means playing it and reading it, both of which can hang
 * on a slow host, so the whole sheet locks rather than letting a second
 * attempt start behind the first.
 */
async function run(work: () => Promise<{ record: Parameters<typeof library.addImport>[0]; note: string | null }>) {
  if (busy.value) return
  busy.value = true
  error.value = null
  note.value = null
  try {
    const result = await work()
    library.addImport(result.record)
    url.value = ''
    if (result.note) note.value = result.note
    else emit('added')
  } catch (e) {
    error.value = e instanceof ImportError ? e.message : 'That one refused to load.'
  } finally {
    busy.value = false
  }
}

function addLink() {
  void run(() => ingestLink(url.value))
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared straight away, or picking the same file twice fires nothing.
  input.value = ''
  if (file) void run(() => ingestFile(file))
}
</script>

<template>
  <!-- Its own layer rather than a panel in the list: the list is a scroll
       container, and a sheet that scrolls away while you're typing into it
       is worse than no sheet. -->
  <div class="fixed inset-0 z-50 flex flex-col justify-end" @click.self="emit('close')">
    <div class="absolute inset-0 bg-ink-900/70" @click="emit('close')" />

    <div class="relative rounded-t-2xl border-t border-ink-600 bg-ink-800 px-4 pt-4 pb-safe">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-[15px] text-cream">Add your own</h2>
        <button class="px-2 h-8 text-[12px] text-flag-dim active:text-cream" @click="emit('close')">
          Close
        </button>
      </div>

      <label class="block text-[10px] uppercase tracking-wider text-ink-500 mb-1">Link</label>
      <form class="flex gap-2" @submit.prevent="addLink">
        <input
          v-model="url"
          type="url"
          inputmode="url"
          enterkeyhint="done"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="https://…/track.mp3"
          :disabled="busy"
          class="flex-1 min-w-0 h-11 px-3 rounded-lg bg-ink-700 text-cream text-[15px]
                 placeholder:text-ink-500 border border-ink-600
                 focus:outline-none focus:border-flag-dim disabled:opacity-50"
        />
        <button
          type="submit"
          class="px-4 h-11 rounded-lg bg-flag text-ink-900 text-[13px] font-medium
                 active:scale-[0.99] transition-transform disabled:opacity-40"
          :disabled="busy || !url.trim()"
        >
          Add
        </button>
      </form>
      <p class="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
        Straight at the audio file, not a page about it.
      </p>

      <div class="flex items-center gap-3 my-3">
        <span class="flex-1 h-px bg-ink-600" />
        <span class="text-[10px] uppercase tracking-wider text-ink-500">or</span>
        <span class="flex-1 h-px bg-ink-600" />
      </div>

      <label
        class="flex items-center justify-center h-12 rounded-lg border border-ink-500
               text-flag-soft text-[13px] active:bg-ink-700"
        :class="busy ? 'opacity-40' : ''"
      >
        Choose a file from this device
        <input
          type="file"
          accept="audio/*"
          class="hidden"
          :disabled="busy"
          @change="onFile"
        />
      </label>

      <p v-if="busy" class="text-center text-[12px] text-flag-dim mt-3">Having a listen…</p>
      <p v-else-if="error" class="text-[12px] text-red-300/80 mt-3 leading-relaxed">
        {{ error }}
      </p>
      <p v-else-if="note" class="text-[12px] text-flag mt-3 leading-relaxed">{{ note }}</p>

      <p class="text-[10px] text-ink-500 mt-3 leading-relaxed">
        Files stay on this device — nothing is uploaded anywhere. Whatever you
        add is yours to be sensible with.
      </p>
    </div>
  </div>
</template>
