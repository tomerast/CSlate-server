import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@cslate/db': path.resolve(__dirname, '../db/src/index.ts'),
      '@cslate/llm': path.resolve(__dirname, '../llm/src/index.ts'),
      '@cslate/storage': path.resolve(__dirname, '../storage/src/index.ts'),
    },
  },
})
