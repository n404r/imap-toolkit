import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/client/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0f1117',
        surface: '#1a1d27',
        border: '#2a2d3a',
        muted: '#6b7280',
        accent: '#6366f1',
        'accent-hover': '#4f46e5',
        danger: '#ef4444',
        success: '#22c55e',
        warning: '#f59e0b',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
