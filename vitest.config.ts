import { defineConfig } from 'vitest/config'

/**
 * Unit tests for main-process logic that is pure enough to run outside Electron:
 * the migration runner, the capability registry's enforcement rules, and (from
 * Phase 1) the scheduler's date maths.
 *
 * Anything touching `electron` directly is aliased to a stub — these tests exist
 * to check logic, not to boot an app.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: [
      { find: /^electron$/, replacement: new URL('./test/stubs/electron.ts', import.meta.url).pathname },

      // better-sqlite3 is a native module, and `postinstall` rebuilds it against
      // Electron's ABI (NODE_MODULE_VERSION 130) so the app can load it. Vitest
      // runs on plain Node (127), which refuses that binary. `better-sqlite3-node`
      // is the same package installed under an alias as a devDependency, left at
      // the Node ABI — so tests exercise the real SQLite engine rather than a
      // mock, and the app's build is untouched.
      //
      // Anchored regex, not a bare string: Vite aliases prefix-match, so
      // 'better-sqlite3' would also rewrite 'better-sqlite3-node' and recurse.
      { find: /^better-sqlite3$/, replacement: 'better-sqlite3-node' },
    ],
  },
})
