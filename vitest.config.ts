import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/main': resolve('src/main'),
      '@/shared': resolve('src/shared'),
      '@/renderer': resolve('src/renderer')
    }
  },
  test: {
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/types/**', 'src/shared/types/**'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60
      }
    }
  }
})
