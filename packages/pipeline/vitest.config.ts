import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['node', 'require', 'default'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
