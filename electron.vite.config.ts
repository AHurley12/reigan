import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // The project scan runs in a worker_thread, which needs its own entry
        // point on disk — `new Worker(path)` cannot reach a module that only
        // exists inside main's bundle. Emitting it as a second chunk keeps it
        // beside index.js in out/main, where scanner/index.ts resolves it.
        input: {
          index: resolve('src/main/index.ts'),
          scanWorker: resolve('src/main/devtools/scanner/scanWorker.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
