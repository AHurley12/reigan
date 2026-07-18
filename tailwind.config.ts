import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/src/**/*.{tsx,ts,jsx,js,html}', './src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        void: '#06080F',
        surface: '#0C1017',
        elevated: '#141922',
        subtle: '#1A2030',
        reigan: {
          primary: '#7C3AED',
          secondary: '#00D4FF',
        },
        active: '#10B981',
        alert: '#F59E0B',
        critical: '#EF4444',
        info: '#3B82F6',
        txt: {
          primary: '#E8ECF4',
          secondary: '#8B95A8',
          muted: '#4A5568',
          kanji: '#6E7A91',
          accent: '#A78BFA',
        },
      },
      fontFamily: {
        display: ['Space Grotesk', 'Noto Sans JP', 'sans-serif'],
        body: ['Inter', 'Noto Sans JP', 'sans-serif'],
        mono: ['JetBrains Mono', 'Noto Sans JP', 'monospace'],
        kanji: ['Zen Kaku Gothic New', 'Noto Sans JP', 'sans-serif'],
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
