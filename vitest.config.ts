import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    setupFiles: ['./src/server/webuiTestStorage.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dist-cli/**', 'output/**'],
  },
})
