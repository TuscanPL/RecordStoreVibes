<script setup lang="ts">
import { computed } from 'vue'
import type { Record as CrateRecord } from '../providers/types'
import { useLibrary } from '../stores/library'

const props = defineProps<{ record: CrateRecord }>()
const library = useLibrary()

const markerCount = computed(() => library.markersFor(props.record.id).length)
const starred = computed(() => library.isStarred(props.record.id))

function onStar(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  library.toggleStar(props.record)
}
</script>

<template>
  <router-link
    :to="`/r/${record.id}`"
    class="flex items-center gap-3 px-4 py-3 active:bg-ink-700 border-b border-ink-700/60"
  >
    <div class="w-14 h-14 flex-none rounded bg-ink-700 overflow-hidden">
      <img
        v-if="record.artworkUrl"
        :src="record.artworkUrl"
        :alt="''"
        loading="lazy"
        class="w-full h-full object-cover"
        @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
      />
    </div>

    <div class="flex-1 min-w-0">
      <p class="text-[15px] leading-tight text-cream line-clamp-2">{{ record.title }}</p>
      <p class="text-[13px] text-flag-dim truncate mt-0.5">
        {{ record.creator }}<span v-if="record.year"> · {{ record.year }}</span>
      </p>
      <p v-if="markerCount" class="text-[11px] text-flag mt-1">
        {{ markerCount }} marker{{ markerCount === 1 ? '' : 's' }}
      </p>
    </div>

    <button
      class="flex-none w-11 h-11 -mr-2 flex items-center justify-center"
      :aria-label="starred ? 'Unstar' : 'Star'"
      @click="onStar"
    >
      <svg
        class="w-6 h-6"
        :class="starred ? 'text-flag' : 'text-ink-500'"
        :fill="starred ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="1.6"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.87L12 16.9l-5.25 2.77 1-5.87L3.5 9.66l5.9-.86z"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </router-link>
</template>
