import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    // Vite strips the `node:` prefix and then fails to resolve the bare
    // `sqlite` builtin, so keep Node builtins external to the test bundle.
    server: {
      deps: {
        external: [/^node:/]
      }
    }
  }
})
