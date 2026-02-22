<script setup lang="ts">
import { useAppStore } from './stores/app'
import GenreSelectScene from './scenes/GenreSelect/GenreSelectScene.vue'
import CrateBrowseScene from './scenes/CrateBrowse/CrateBrowseScene.vue'
import TurntableScene from './scenes/Turntable/TurntableScene.vue'

const store = useAppStore()
</script>

<template>
  <div class="w-full h-full relative bg-vinyl-black">
    <Transition
      mode="out-in"
      enter-active-class="transition-opacity duration-700 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-500 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <GenreSelectScene v-if="store.currentScene === 'genre-select'" key="genre" />
      <CrateBrowseScene v-else-if="store.currentScene === 'crate-browse'" key="crate" />
      <TurntableScene v-else-if="store.currentScene === 'turntable'" key="turntable" />
    </Transition>
  </div>
</template>
