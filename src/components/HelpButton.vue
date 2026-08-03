<script setup lang="ts">
import { ref } from 'vue'
import { HELP, type HelpKey } from '../help'

/**
 * The same mark in the same corner on every view.
 *
 * Trigger and panel in one component: four views each adding a button and
 * an overlay is four chances for them to drift apart, and the whole value
 * of this is that it's always the same thing in the same place.
 */
const props = defineProps<{ topic: HelpKey }>()
const open = ref(false)
</script>

<template>
  <button
    class="w-9 h-9 flex-none flex items-center justify-center self-center"
    :aria-label="`What this view does: ${HELP[props.topic].title}`"
    @click="open = true"
  >
    <span
      class="w-5 h-5 flex items-center justify-center rounded-full border
             border-ink-500 text-[11px] leading-none text-flag-dim"
    >
      ?
    </span>
  </button>

  <div v-if="open" class="fixed inset-0 z-50 flex flex-col justify-end">
    <div class="absolute inset-0 bg-ink-900/70" @click="open = false" />

    <div class="relative rounded-t-2xl border-t border-ink-600 bg-ink-800 pb-safe">
      <div class="flex items-baseline justify-between px-4 pt-4 pb-2">
        <h2 class="text-[16px] text-cream">{{ HELP[props.topic].title }}</h2>
        <button class="px-2 h-8 text-[12px] text-flag-dim active:text-cream" @click="open = false">
          Close
        </button>
      </div>

      <!-- Capped and scrollable rather than sized to fit: a long topic on a
           short phone would otherwise push its own Close button off. -->
      <div class="px-4 pb-2 max-h-[62vh] scroll-y">
        <p class="text-[13px] text-flag-dim leading-relaxed mb-3">
          {{ HELP[props.topic].blurb }}
        </p>

        <dl class="space-y-3">
          <div v-for="item in HELP[props.topic].items" :key="item.term">
            <dt class="text-[12px] uppercase tracking-wider text-flag">{{ item.term }}</dt>
            <dd class="text-[13px] text-flag-soft leading-relaxed mt-0.5">{{ item.text }}</dd>
          </div>
        </dl>

        <p class="text-[11px] text-ink-500 leading-relaxed mt-4">
          Two rules the rest of it follows: one thumb, and it has to end.
        </p>
      </div>
    </div>
  </div>
</template>
