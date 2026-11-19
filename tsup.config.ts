import { defineConfig } from 'tsup'
import { holdWebuiWriterLease } from './src/server/webuiMaintenance.mjs'

export default defineConfig(() => {
  holdWebuiWriterLease()
  return {
    entry: ['src/cli/index.ts'],
    outDir: 'dist-cli',
    format: 'esm',
    target: 'node18',
    sourcemap: true,
    clean: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
    external: ['express', 'commander', 'proper-lockfile'],
  }
})
