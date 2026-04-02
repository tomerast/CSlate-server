import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@cslate/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@cslate/queue': path.resolve(__dirname, 'packages/queue/src/index.ts'),
      '@cslate/llm': path.resolve(__dirname, 'packages/llm/src/index.ts'),
      '@cslate/storage': path.resolve(__dirname, 'packages/storage/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/src/**/__tests__/**/*.test.ts', 'apps/*/src/**/__tests__/**/*.test.ts'],
  },
})
