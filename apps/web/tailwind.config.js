import foxfire from '@foxfire/ui/tailwind.preset'

/**
 * Foxfire's theme is @foxfire/ui's preset, shared with the desktop.
 *
 * The content globs reach into the two packages the screens are built from, or
 * Tailwind would never see the classes they use and the build would ship
 * without them. `relative` resolves them from this file rather than from
 * wherever the build happens to run.
 */
/** @type {import('tailwindcss').Config} */
export default {
  presets: [foxfire],
  content: {
    relative: true,
    files: [
      './index.html',
      './src/**/*.{js,ts,jsx,tsx}',
      '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
      '../../packages/screens/src/**/*.{js,ts,jsx,tsx}'
    ]
  }
}
