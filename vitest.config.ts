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
      exclude: [
        'src/main/types/**',
        'src/shared/types/**',
        'src/main/index.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      }
    }
  }
})
