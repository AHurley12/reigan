import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/src/**/*.{tsx,ts,jsx,js,html}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        void: '#0B0A08',
        surface: '#16140F',
        elevated: '#1E1B15',
        subtle: '#272319',
        reigan: {
          primary: '#D8432A',
          secondary: '#23A18C',
        },
        gold: '#C9A227',
        active: '#23A18C',
        alert: '#C9A227',
        critical: '#E5484D',
        info: '#5B7A99',
        txt: {
          primary: '#EDE6D6',
          secondary: '#B5AB98',
          muted: '#6B6455',
          kanji: '#8A8065',
          accent: '#E0A54A',
        },
      },
      fontFamily: {
        display: ['Rajdhani', 'Zen Kaku Gothic New', 'sans-serif'],
        body: ['Inter', 'Noto Sans JP', 'sans-serif'],
        mono: ['JetBrains Mono', 'Noto Sans JP', 'monospace'],
        kanji: ['Zen Kaku Gothic New', 'Noto Sans JP', 'sans-serif'],
        seal: ['Shippori Mincho B1', 'Zen Kaku Gothic New', 'serif'],
      },
      spacing: {
        nav: '54px',
        titlebar: '38px',
        inputbar: '64px',
        orb: '120px',
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        pill: '999px',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        normal: '200ms',
        slow: '300ms',
      },
    },
  },
  plugins: [],
} satisfies Config
