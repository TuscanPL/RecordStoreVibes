<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  message?: string
}>()

const clerkPhrases = [
  "Let me dig through the back for you...",
  "Ah, I think I've got just the thing...",
  "Fresh shipment came in this morning...",
  "You've got good taste. Try these.",
  "These just came in from an estate sale...",
  "A collector traded these in yesterday...",
  "I was saving these for someone special...",
  "Check these out — real deep cuts.",
  "Lemme see what else we've got...",
  "Hold on, I know there's more back here...",
]

const currentPhrase = ref(clerkPhrases[0])

watch(() => props.visible, (visible) => {
  if (visible) {
    currentPhrase.value = clerkPhrases[Math.floor(Math.random() * clerkPhrases.length)]
  }
})
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-500 ease-out"
    enter-from-class="opacity-0 translate-y-4"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-300 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-4"
  >
    <div
      v-if="visible"
      class="bg-vinyl-warm/95 backdrop-blur-sm rounded-lg p-4 border border-vinyl-amber/30 max-w-xs"
    >
      <div class="flex items-start gap-3">
        <!-- Clerk avatar -->
        <div class="w-10 h-10 rounded-full bg-vinyl-brown flex items-center justify-center flex-shrink-0 text-lg">
          🎵
        </div>

        <div>
          <p class="text-[10px] uppercase tracking-wider text-vinyl-amber/60 mb-1">The Clerk</p>
          <p class="text-sm text-vinyl-cream/90 font-body leading-relaxed italic">
            "{{ message || currentPhrase }}"
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>
