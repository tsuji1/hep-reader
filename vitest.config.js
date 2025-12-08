import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.js', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.js', 'server/**/*.ts'],
      exclude: ['server/**/*.test.js', 'server/**/*.test.ts', 'server/dist/**']
    }
  }
})
