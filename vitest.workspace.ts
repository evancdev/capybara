import { resolve } from 'path'
import { defineWorkspace } from 'vitest/config'

process.env.NODE_ENV = 'test'

export default defineWorkspace([
  {
    // Backend tests -- Node environment
    extends: './vitest.config.ts',
    test: {
      name: 'backend',
      include: ['test/**/*.test.ts'],
      exclude: ['test/renderer/**'],
      environment: 'node'
    },
    resolve: {
      alias: {
        '@/main': resolve('src/main'),
        '@/shared': resolve('src/shared')
      }
    }
  },
  {
    // Renderer tests -- jsdom environment
    test: {
      name: 'renderer',
      include: ['test/renderer/**/*.test.tsx'],
      environment: 'jsdom',
      setupFiles: ['test/renderer/setup.ts'],
      css: {
        modules: {
          classNameStrategy: 'non-scoped'
        }
      }
    },
    resolve: {
      alias: {
        '@/renderer': resolve('src/renderer'),
        '@/shared': resolve('src/shared')
      }
    }
  }
])
