import { screen } from 'electron'

/**
 * The refresh rate a 'display' quality preset records at: the fastest monitor's.
 *
 * Not the game's monitor, which nothing here can tell — the game window is only
 * known to FFmpeg. The fastest one is the safe guess both ways: with the game on
 * it, every frame is kept; with the game on a slower one, the extra frames are
 * repeats, which cost a little disk and nothing anybody can see. Guessing low is
 * what makes footage judder.
 */
export function displayRefreshRate(): number {
  const rates = screen
    .getAllDisplays()
    .map((display) => display.displayFrequency)
    .filter((hz) => Number.isFinite(hz) && hz > 0)
  return clampRefreshRate(rates.length > 0 ? Math.max(...rates) : 60)
}

/**
 * Whole frames per second, within reason. A 143.86 Hz panel records at 144 —
 * one repeated frame every few seconds — and a reading nobody believes falls
 * back to the ordinary rates rather than to a recording at 2 or 2000 fps.
 */
export function clampRefreshRate(hz: number): number {
  if (!Number.isFinite(hz) || hz < 24) return 60
  return Math.min(Math.round(hz), 360)
}
