import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    // Agent worktrees under .claude/ are full checkouts, so their copies of these
    // same test files would otherwise be collected and counted twice — and a
    // stale branch's failures would be reported against this one.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Vite strips the `node:` prefix and then fails to resolve the bare
    // `sqlite` builtin, so keep Node builtins external to the test bundle.
    server: {
      deps: {
        external: [/^node:/]
      }
    }
  }
})
