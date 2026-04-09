import { resolve } from 'path'
import { defineWorkspace } from 'vitest/config'

process.env.NODE_ENV = 'test'

export default defineWorkspace([
  {
    // Backend tests -- Node environment.
    // Inherits resolve.alias + coverage config from vitest.config.ts.
    extends: './vitest.config.ts',
    test: {
      name: 'backend',
      include: [
        'test/main/**/*.test.ts',
        'test/shared/**/*.test.ts',
        'test/renderer/lib/**/*.test.ts'
      ],
      environment: 'node'
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
