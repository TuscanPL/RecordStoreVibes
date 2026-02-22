<script setup lang="ts">
import { useAppStore } from '../../stores/app'

const store = useAppStore()
</script>

<template>
  <div class="flex items-center gap-3 bg-vinyl-warm/90 backdrop-blur-sm rounded-full px-4 py-2 border border-vinyl-amber/20">
    <!-- Record dots -->
    <div class="flex gap-1.5">
      <div
        v-for="i in store.maxRecords"
        :key="i"
        class="w-3 h-3 rounded-full border transition-all duration-300"
        :class="i <= store.selectedRecords.length
          ? 'bg-vinyl-amber border-vinyl-amber scale-110'
          : 'bg-transparent border-vinyl-amber/30'"
      />
    </div>

    <span class="text-xs text-vinyl-cream/80 font-body">
      {{ store.selectedRecords.length }}/{{ store.maxRecords }}
    </span>
  </div>
</template>
