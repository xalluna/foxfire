/**
 * The League client's gameflow phase, for anybody who needs to know it.
 *
 * Pushed in by the watcher rather than read out of it, the same shape
 * appIcon.ts uses: the upload queue wants the phase, and importing the watcher
 * into it would drag the LCU, the database and the capture service along.
 * Null when there is no client, or no answer from one.
 */
type Listener = (phase: string | null) => void

let current: string | null = null
const listeners = new Set<Listener>()

export function getGameflowPhase(): string | null {
  return current
}

export function setGameflowPhase(next: string | null): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener(next)
}

export function onGameflowPhase(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
