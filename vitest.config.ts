import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      // The fileops modules are main-process code and import `electron` for
      // userData paths and the native directory picker. Outside an Electron
      // runtime, `require('electron')` resolves to a *string* (the path to the
      // binary), so a named import would be undefined at best. The stub gives
      // tests a real, inspectable object instead of mocking per-file.
      electron: resolve('src/main/fileops/__tests__/stubs/electron.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // Filesystem fixtures (junctions, exclusive handles) are cheap but real;
    // a generous timeout keeps a slow disk from producing a phantom failure.
    testTimeout: 20_000,
  },
})
