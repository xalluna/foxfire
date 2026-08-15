/**
 * Colours are declared as space-separated RGB channels in styles/index.css and
 * wrapped here with <alpha-value>, so every token supports Tailwind's opacity
 * modifier — `bg-surface/60`, `border-gold/30` — instead of needing a separate
 * token per transparency level.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        hairline: token('hairline'),
        gold: token('gold'),
        'gold-dim': token('gold-dim'),
        teal: token('teal'),
        red: token('red'),
        amber: token('amber'),
        text: token('text'),
        'text-dim': token('text-dim'),
        'text-mute': token('text-mute')
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        // Display only: app title, view headings, rank tiers, large summary figures.
        display: ['Marcellus', 'Georgia', 'serif']
      },
      fontSize: {
        // The UI lives between 10 and 13px; these carry line-heights so dense
        // rows stay on a predictable rhythm.
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
        xs: ['0.6875rem', { lineHeight: '1rem' }],
        sm: ['0.75rem', { lineHeight: '1.125rem' }],
        base: ['0.8125rem', { lineHeight: '1.25rem' }],
        lg: ['0.9375rem', { lineHeight: '1.375rem' }],
        xl: ['1.125rem', { lineHeight: '1.5rem' }],
        '2xl': ['1.5rem', { lineHeight: '1.875rem' }],
        '3xl': ['2rem', { lineHeight: '2.375rem' }]
      },
      spacing: {
        rail: '64px', // collapsed account rail
        'rail-open': '224px', // expanded on hover
        stats: '320px', // identity rail
        titlebar: 'var(--titlebar-h)'
      },
      boxShadow: {
        // Hextech surfaces read as lit panels: a gold hairline plus depth.
        panel: '0 1px 2px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(var(--hairline))',
        raised: '0 4px 12px -2px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(var(--hairline))',
        flyout: '0 12px 32px -4px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(var(--gold-dim) / 0.5)',
        'gold-glow': '0 0 0 1px rgb(var(--gold) / 0.4), 0 0 12px -2px rgb(var(--gold) / 0.25)'
      },
      borderRadius: {
        DEFAULT: '3px',
        md: '4px',
        lg: '6px'
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        'flyout-in': {
          from: { opacity: '0', transform: 'translateX(-4px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        }
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'flyout-in': 'flyout-in 120ms ease-out'
      }
    }
  },
  plugins: []
}
