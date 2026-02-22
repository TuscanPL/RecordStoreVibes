import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { templateCompilerOptions } from '@tresjs/core'

export default defineConfig({
  base: '/RecordStoreVibes/',
  plugins: [
    vue({
      ...templateCompilerOptions,
    }),
  ],
})
