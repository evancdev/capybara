import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@/main': resolve('src/main'),
        '@/shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@/shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@/renderer': resolve('src/renderer'),
        '@/shared': resolve('src/shared')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
})
