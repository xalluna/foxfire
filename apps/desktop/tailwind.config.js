import foxfire from '@foxfire/ui/tailwind.preset'

/**
 * Foxfire's theme is @foxfire/ui's preset, shared with the web client. What is
 * added here belongs to this window alone: the height of the drag strip the
 * native caption buttons sit over.
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
      './src/renderer/index.html',
      './src/renderer/src/**/*.{js,ts,jsx,tsx}',
      '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
      '../../packages/screens/src/**/*.{js,ts,jsx,tsx}'
    ]
  },
  theme: {
    extend: {
      spacing: {
        titlebar: 'var(--titlebar-h)'
      }
    }
  }
}
