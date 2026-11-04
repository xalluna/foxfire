import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { gameRegistrySnapshot } from './snapshot'

/**
 * The TypeScript half of the check that keeps the server's registry in step.
 *
 * fixtures/game-registry.json is what the server's GameRegistryTests read. This
 * says the file still describes this registry — so a game or ladder added here
 * without regenerating the file, and so without the server hearing of it,
 * fails here first.
 *
 * Regenerate with `npm run generate-game-registry`.
 */

/** Walks up to the repo root rather than counting directories; see ladder.corpus.test.ts. */
function findFixture(): string {
  let dir = dirname(fileURLToPath(import.meta.url))

  for (;;) {
    const candidate = join(dir, 'fixtures', 'game-registry.json')
    if (existsSync(candidate)) return candidate

    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('fixtures/game-registry.json was not found. Generate it with `npm run generate-game-registry`.')
    }
    dir = parent
  }
}

describe('fixtures/game-registry.json', () => {
  it('still describes the registry and the TFT rules', () => {
    const recorded: unknown = JSON.parse(readFileSync(findFixture(), 'utf8'))
    expect(recorded).toEqual(JSON.parse(JSON.stringify(gameRegistrySnapshot())))
  })
})
