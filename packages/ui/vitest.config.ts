import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Agent worktrees under .claude/ are full checkouts, so their copies of these
    // same test files would otherwise be collected and counted twice.
    exclude: [...configDefaults.exclude, '.claude/**']
  }
})
