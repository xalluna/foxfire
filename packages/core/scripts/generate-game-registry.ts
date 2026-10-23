/**
 * Writes fixtures/game-registry.json: the games and ladders as
 * src/games/registry.ts and ladders.ts declare them, and the answers the TFT
 * rules give for a spread of lobbies.
 *
 * Run with: npm run generate-game-registry   (from packages/core)
 *
 * The server keeps its own copy of the registry — Foxfire.Core/Games.cs and
 * RankedQueues.cs — because a ladder name crosses its database, its routes and
 * Riot's payloads, and a C# type is what stops a typo filing a game against
 * nothing. Two copies drift; this file is what catches it. The TypeScript test
 * checks it still matches the registry, and GameRegistryTests checks the C#
 * agrees with it, so a game or ladder added to one and not the other fails a
 * build rather than a sync.
 *
 * The rule cases are the ones the server computes too: Double Up's team
 * placement, a rated ladder's movement, and where a TFT game sits among rank
 * readings. Everything is enumerated, so the file is the same on any machine.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gameRegistrySnapshot } from '../src/games/snapshot'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', '..', 'fixtures', 'game-registry.json')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(gameRegistrySnapshot(), null, 2) + '\n')
console.log(`wrote ${OUT}`)
