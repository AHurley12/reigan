import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/src/**/*.{tsx,ts,jsx,js,html}', './src/renderer/index.html'],
  theme: {
    extend: {
      // Every colour resolves through the active theme, the same mechanism
      // already used for fontFamily and borderRadius. These were literal hexes
      // until 2026-08-08, which meant `bg-elevated` and `text-txt-muted`
      // rendered Shingan's palette under *every* skin — the single largest
      // source of skin coverage gaps in the app.
      //
      // The `rgb(var(--rgb-*) / <alpha-value>)` form (rather than a plain
      // `var(--x)`) is what keeps the opacity modifier working: `bg-tint/10`,
      // `bg-critical/20`, `border-reigan-primary/50` all still compose. The
      // --rgb-* channel triplets are emitted by theme/applyTokens.ts.
      colors: {
        void: 'rgb(var(--rgb-surface-base) / <alpha-value>)',
        surface: 'rgb(var(--rgb-surface-raised) / <alpha-value>)',
        elevated: 'rgb(var(--rgb-surface-overlay) / <alpha-value>)',
        subtle: 'rgb(var(--rgb-surface-sunken) / <alpha-value>)',
        reigan: {
          primary: 'rgb(var(--rgb-accent-primary) / <alpha-value>)',
          secondary: 'rgb(var(--rgb-accent-secondary) / <alpha-value>)',
        },
        gold: 'rgb(var(--rgb-accent-secondary) / <alpha-value>)',
        active: 'rgb(var(--rgb-accent-secondary) / <alpha-value>)',
        alert: 'rgb(var(--rgb-accent-secondary) / <alpha-value>)',
        critical: 'rgb(var(--rgb-accent-danger) / <alpha-value>)',
        info: 'rgb(var(--rgb-accent-secondary) / <alpha-value>)',
        txt: {
          primary: 'rgb(var(--rgb-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--rgb-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--rgb-text-muted) / <alpha-value>)',
          kanji: 'rgb(var(--rgb-text-kanji) / <alpha-value>)',
          accent: 'rgb(var(--rgb-text-accent) / <alpha-value>)',
          'on-accent': 'rgb(var(--rgb-text-on-accent) / <alpha-value>)',
          'on-glass': 'rgb(var(--rgb-text-on-glass) / <alpha-value>)',
        },
        // The interaction wash. Replaces ~22 `bg-white/N` usages, which read as
        // "lighter" on a dark skin and as nothing at all on a light one.
        tint: 'rgb(var(--rgb-state-tint) / <alpha-value>)',
        scrim: 'var(--surface-scrim)',
      },
      // Every family resolves through a custom property so the ~80 existing
      // `font-display` / `font-kanji` / … utility usages across the app follow
      // the active theme. The concrete stacks live in each theme's tokens.ts;
      // the fallback after the var is only what applies before the first
      // applyTokens() call (i.e. never, in practice).
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
        kanji: ['var(--font-kanji)', 'sans-serif'],
        seal: ['var(--font-seal)', 'serif'],
      },
      // Each size stepped up one rung. Stated in px, not rem, for two reasons:
      // Tailwind's defaults are rem and the app pins the rem anchor at 14px
      // (see globals.css), so `text-xs` was really rendering at 10.5px, not
      // 12px — reasoning in rem here would silently overshoot. And px keeps
      // type decoupled from that anchor, which exists to serve the spacing
      // scale. The old rendered size is in the comment beside each new one.
      // Type is stepped rather than multiplied by UI_SCALE so every size lands
      // on a whole pixel; the 1.15x everything else gets comes from the window
      // zoom factor, which multiplies these too.
      // Line heights are restated because supplying a bare size string drops
      // the utility's line-height back to the body's inherited 1.5.
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }], // was 10.5px
        sm: ['14px', { lineHeight: '20px' }], // was 12.25px
        base: ['16px', { lineHeight: '24px' }], // was 14px
        lg: ['18px', { lineHeight: '26px' }], // was 15.75px
        xl: ['20px', { lineHeight: '28px' }], // was 17.5px
        '2xl': ['24px', { lineHeight: '32px' }], // was 21px
        '3xl': ['30px', { lineHeight: '36px' }], // was 26.25px
        '4xl': ['36px', { lineHeight: '40px' }], // was 31.5px
        '5xl': ['48px', { lineHeight: '1' }], // was 42px
        '6xl': ['60px', { lineHeight: '1' }], // was 52.5px
      },
      spacing: {
        nav: '62px',
        titlebar: '38px',
        inputbar: '64px',
        orb: '120px',
      },
      // Same reasoning as fontFamily: these resolve through the theme so the
      // ~56 `rounded-sm/md/lg` usages across the app share one corner
      // language. Gothic's sharper 2/6/10 was previously ignored everywhere a
      // Tailwind utility was used, which is what made a single column show
      // 0px, 8px and 12px corners side by side.
      // DEFAULT is listed because bare `rounded` (26 usages, mostly small
      // buttons and chips) otherwise keeps Tailwind's stock 0.25rem and sits
      // beside themed corners at a radius no theme chose.
      borderRadius: {
        DEFAULT: 'var(--radius-sm)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        '2xl': 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
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
