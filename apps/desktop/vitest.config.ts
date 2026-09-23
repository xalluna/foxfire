import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // Tests exercise what a build with every feature on would do. A switched-off
  // build runs less of the same code, not different code.
  define: {
    __FEATURE_YOUTUBE__: 'true'
  },
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
