# Skin Contract

The permanent reference for how skinning works in Shingan, and what it takes to add
a new one. If the code and this document disagree, one of them is a bug.

Terminology: the product calls them **skins**; the code calls them **themes**. The
registry ids are `shingan` (product name "Shingan"), `gothic` ("Sepulchral") and
`aero` ("Frutiger Aero"). This document uses the code's names, since those are
what you type.

---

## 1. Architecture verdict

**The skin system is a pure CSS-custom-property token layer.** There is not one
`theme.id === 'gothic'` conditional anywhere in `src/renderer/src/components/`
(verified by grep). Components name *semantic roles*; the theme decides what
those roles look like.

Three escape hatches exist, and all are legitimate:

| Hatch | Where | Why |
| --- | --- | --- |
| `theme.tokens.*` read in JS | `Lock/AuthOrb`, `Lock/LockScreen`, `Lock/CircularWaveform`, `Lock/EnrollmentFlow`, `Orb/VoiceOrb` | Canvas/WebGL cannot read CSS custom properties. They read token *values*, never the id. |
| `theme.textReveal` read in JS | `Chat/InscribeText` | The reveal animation name/unit/timing is data; the component is mechanism only. |
| `html[data-theme='…']` CSS | `themes/gothic/{ornament,signature}.css`, `themes/aero/{aero,ambient}.css` | Material and decoration a token can't express. Scoped in CSS, invisible to components. |

---

## 2. How a skin gets applied

Execution order. There is no flash of the wrong skin at any point.

1. **Main process, before the window exists** — `src/main/index.ts` reads the
   persisted `theme` setting synchronously from SQLite, then sets
   `BrowserWindow.backgroundColor` from `THEME_BACKGROUNDS` and passes
   `additionalArguments: ['--initial-theme=<id>']`.
2. **Preload, before renderer scripts run** — `src/preload/index.ts` sets
   `document.documentElement.setAttribute('data-theme', id)`.
3. **Renderer, before first paint** — `theme/ThemeProvider.tsx` runs a
   `useLayoutEffect` calling `applyTokens(theme.tokens)` and
   `applyThemeVars(theme)`, then sets `data-theme` and `colorScheme`.
4. **Theme CSS** is imported from each theme's `tokens.ts`, so it is bundled
   eagerly and always present, inert until `data-theme` matches. Deliberate: the
   CSS must already be in the document when the attribute flips.

**Transport is `data-theme` on `<html>` plus custom properties on `:root`.**

### Naming: token path → CSS variable

`applyTokens` kebab-cases the path:

```
tokens.surface.raised        ->  --surface-raised
tokens.text.onAccent         ->  --text-on-accent
tokens.type.scale.xs         ->  --type-scale-xs
tokens.motion.durationFast   ->  --motion-duration-fast
```

### `--rgb-*` channel triplets (needed by Tailwind)

Every token whose value parses as a colour is published **twice**: once as
itself, and once as `--rgb-<name>` holding bare channels (`255 255 255`).
Tailwind's colours are declared as `rgb(var(--rgb-…) / <alpha-value>)`, which is
what keeps the opacity modifier working (`bg-tint/10`, `bg-critical/20`,
`border-reigan-primary/50`).

> **Gotcha.** A token value that is not a hex or `rgb()/rgba()` string produces
> no triplet. That is why aero's `surface.base` is `rgba(127,212,245,0)` and not
> the keyword `transparent` — the keyword would break `bg-void`.

### The legacy alias layer

~28 older names (`--bg-void`, `--reigan-primary`, `--font-body`, …) are
redefined as *references* to canonical tokens. This is why ~23 pre-existing
components reskin without being edited. Map: `LEGACY_ALIASES` in
`theme/applyTokens.ts`.

> **Gotcha.** Aliases are written as **inline styles on `<html>`**, so they beat
> every stylesheet rule — a skin cannot override one from its own CSS. If a skin
> needs to control something exposed only through an alias, the alias must point
> at a real token. That is why `accent.gradient` exists: `--reigan-gradient`
> used to be a hardcoded two-stop ramp, and Aero needs a gloss there.
>
> For the same reason, `--text-accent` and `--text-kanji` are deliberately **not**
> aliased: they are real tokens, and aliasing them would overwrite the token.

### Tailwind

`tailwind.config.ts` resolves `colors`, `fontFamily` and `borderRadius` through
custom properties. That is what makes `bg-elevated`, `font-body` and
`rounded-md` skin-aware at their ~150 combined call sites without touching any
of them.

---

## 3. Persistence

`useTheme().setTheme(id)` → `settingsStore.set('theme', id)` →
`window.reigan.setSetting` → IPC → SQLite. Read back at launch by main.
**Survives restart with no flash.**

`setTheme` also stamps `data-theme-transitioning="true"` for 280ms, enabling a
240ms cross-fade on `background-color`/`color`/`border-color`. Measured switch
cost: **6–8.7ms** to apply (budget 100ms).

---

## 4. Token table

### 4.1 Colour and material

| Token | CSS var | `shingan` | `gothic` | `aero` |
| --- | --- | --- | --- | --- |
| `surface.base` | `--surface-base` | `#0B0A08` | `#0A0B0F` | `rgba(127,212,245,0)` |
| `surface.raised` | `--surface-raised` | `#16140F` | `#16181F` | `rgba(255,255,255,0.40)` |
| `surface.overlay` | `--surface-overlay` | `#1E1B15` | `#1D2029` | `rgba(255,255,255,0.55)` |
| `surface.sunken` | `--surface-sunken` | `#272319` | `#06070A` | `rgba(11,110,150,0.16)` |
| `surface.scrim` | `--surface-scrim` | `rgba(11,10,8,0.7)` | `rgba(6,7,10,0.72)` | `rgba(6,62,86,0.44)` |
| `surface.glossTop` | `--surface-gloss-top` | `rgba(237,230,214,0.04)` | `rgba(198,195,186,0.10)` | `rgba(255,255,255,0.24)` |
| `surface.glossBottom` | `--surface-gloss-bottom` | `rgba(0,0,0,0.10)` | `rgba(0,0,0,0.30)` | `rgba(201,221,232,0.08)` |
| `surface.glassTint` | `--surface-glass-tint` | `rgba(0,0,0,0)` | `rgba(10,11,15,0.55)` | `rgba(244,251,255,0.40)` |
| `surface.glassBlur` | `--surface-glass-blur` | `0px` | `10px` | `9px` |
| `text.primary` | `--text-primary` | `#EDE6D6` | `#ADABA3` | `#06303F` |
| `text.secondary` | `--text-secondary` | `#B5AB98` | `#87827A` | `#134B60` |
| `text.muted` | `--text-muted` | `#6B6455` | `#524F49` | `#234657` |
| `text.inverse` | `--text-inverse` | `#0B0A08` | `#0A0B0F` | `#F4FBFF` |
| `text.accent` | `--text-accent` | `#E0A54A` | `#8C2B3B` | `#0B6E96` |
| `text.kanji` | `--text-kanji` | `#8A8065` | `#87827A` | `#234657` |
| `text.onAccent` | `--text-on-accent` | `#FFFFFF` | `#E8E4DA` | `#FFFFFF` |
| `text.onGlass` | `--text-on-glass` | `#EDE6D6` | `#ADABA3` | `#06303F` |
| `accent.primary` | `--accent-primary` | `#D8432A` | `#6E1423` | `#16A8D8` |
| `accent.secondary` | `--accent-secondary` | `#23A18C` | `#4A6656` | `#8FD400` |
| `accent.danger` | `--accent-danger` | `#E5484D` | `#9E2A3D` | `#D9452F` |
| `accent.success` | `--accent-success` | `#23A18C` | `#4A6656` | `#8FD400` |
| `accent.gradient` | `--accent-gradient` | 135° shu→gold | 135° oxblood→verdigris | 180° gloss, hard terminator |
| `border.subtle` | `--border-subtle` | `rgba(237,230,214,0.07)` | `rgba(173,171,163,0.08)` | `rgba(6,62,86,0.14)` |
| `border.strong` | `--border-strong` | `rgba(237,230,214,0.14)` | `rgba(173,171,163,0.16)` | `rgba(6,62,86,0.28)` |
| `border.focus` | `--border-focus` | `#23A18C` | `#C1495B` | `#16A8D8` |
| `state.tint` | `--state-tint` | `#FFFFFF` | `#FFFFFF` | `#06303F` |
| `state.selected` | `--state-selected` | `rgba(255,255,255,0.10)` | same | `rgba(22,168,216,0.24)` |
| `state.disabledOpacity` | `--state-disabled-opacity` | `0.4` | `0.4` | `0.45` |
| `edge.highlight` | `--edge-highlight` | `transparent` | `rgba(198,195,186,0.16)` | `rgba(255,255,255,0.9)` |
| `edge.shadow` | `--edge-shadow` | `transparent` | `rgba(0,0,0,0.55)` | `rgba(11,110,150,0.22)` |
| `bevel.outer` | `--bevel-outer` | `0 8px 24px /0.45` | `0 8px 24px /0.6` | `0 8px 24px rgba(6,62,86,0.26)` |
| `bevel.inner` | `--bevel-inner` | faint top lining | silver lining | white top + water underside |
| `bevel.pressed` | `--bevel-pressed` | `none` | `none` | inset 2px 6px |
| `bevel.cast` | `--bevel-cast` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.5)` | `rgba(6,62,86,0.24)` |
| `sheen.angle` | `--sheen-angle` | `180deg` | `180deg` | `180deg` |
| `sheen.specular` | `--sheen-specular` | `transparent` | `transparent` | `rgba(255,255,255,0.60)` |
| `ambient.layerOpacity` | `--ambient-layer-opacity` | `0` | `1` | `1` |
| `ambient.layerBlend` | `--ambient-layer-blend` | `normal` | `normal` | `normal` |
| `ambient.layerZ` | `--ambient-layer-z` | `0` | `0` | `-1` |
| `focus.glow` | `--focus-glow` | `none` | `none` | `0 0 0 4px rgba(22,168,216,0.30)` |
| `effect.glow` | `--effect-glow` | shu glow | oxblood glow | aqua glow |
| `effect.noiseOpacity` | `--effect-noise-opacity` | `0` | `0.04` | `0` |
| `effect.texture` | `--effect-texture` | `none` | `none` | `none` |

**`ambient.layerZ` is load-bearing.** `0` puts the ambient layer above in-flow
content — right for a sparse dark overlay (fog, embers). `-1` puts it behind
everything — required for a bright full-bleed ground, and it only works if the
skin's `surface.base` is transparent and its surfaces are translucent.

### 4.2 Geometry, type, motion

| Token | `shingan` | `gothic` | `aero` |
| --- | --- | --- | --- |
| `radius.sm/md/lg/pill` | `6/8/12/999px` | `3/6/10/999px` | `5/9/13/999px` |
| `space.xs…xl` | `8/16/24/32/48px` | `4/8/16/24/40px` | `8/16/24/32/48px` |
| `type.display` | Rajdhani | Cormorant Garamond | Frutiger → Segoe UI |
| `type.body` | Inter | IBM Plex Sans | Frutiger → Segoe UI |
| `type.mono` | JetBrains Mono | IBM Plex Mono | Consolas |
| `type.kanji` | Zen Kaku Gothic New | Yu Mincho | Meiryo |
| `type.seal` | Shippori Mincho B1 | Cormorant Garamond | Segoe UI |
| `type.scale.*` | 12/14/16/20/28/44px | same | same |
| `type.weight` | 400/500/700 | 400/500/600 | 400/600/700 |
| `type.tracking` | `-0.01em/0/0.06em` | `-0.01em/0/0.08em` | `-0.005em/0/0.045em` |
| `motion.duration fast/base/slow` | 120/200/300ms | 150/240/420ms | 140/220/340ms |

> `radius.lg` must match the RADIUS constant in a skin's `frame.ts` if it ships
> a nine-slice frame, or the moulding stops tracking the edge of the box.

### 4.3 Non-token `Theme` fields

| Field | Required | Purpose |
| --- | --- | --- |
| `id` | yes | Must equal the registry key; becomes `data-theme` |
| `name`, `description` | yes | Shown in the theme selector |
| `colorScheme` | yes | `'dark' \| 'light'` → native controls and scrollbar defaults |
| `motionProfile` | yes | `{ maxParticles, targetFps, pauseOnBlur }` — a ceiling the ambient layer must respect |
| `textReveal` | yes | `{ animation, unit, durationMs, staggerMs, maxDelayMs }` |
| `watermark?` | no | `() => string` — a `background-image`, painted by `.chat-surface::before` |
| `frame?` | no | `() => ThemeFrame` — nine-slice `border-image` for `.ornate` |
| `Effects` | yes | `React.lazy` ambient layer, receives `{ reducedMotion, paused }` |
| `previewGradient` | yes | Static swatch for the selector |

### 4.4 Variables written outside the token tree

| CSS var | Written by | Default when absent |
| --- | --- | --- |
| `--effect-grain-image` | `applyTokens` (from `effect.noiseOpacity`) | `none` |
| `--status-{idle,listening,processing,speaking,error,success}` | `applyTokens`, derived from `text.muted` / `accent.*` / `text.accent` | Shingan values in `globals.css` |
| `--theme-watermark` | `applyThemeVars` | `none` |
| `--theme-frame`, `--theme-frame-focus`, `--theme-frame-slice`, `--theme-frame-width` | `applyThemeVars` | `none/none/0/0` |

### 4.5 Structural classes a theme may decorate

Themes hook these; components only apply them.

| Class | Meaning |
| --- | --- |
| `.rule` / `.rule-b` / `.rule-l` / `.rule-r` | The app's only divider |
| `.rule-ornate` | Divider with a centred ornament; falls back to a plain line |
| `.ornate` / `.ornate-focus` | A container the theme may frame; falls back to a plain hairline |
| `.panel-surface` | A raised panel |
| `.panel-ornate` | Opt-in corner filigree |
| `.chat-surface` | The chat ground; carries `--theme-watermark` |
| `.grained` | Carries `--effect-grain-image` |
| `.glass-panel` / `.gloss-button` / `.chrome-bezel` | Opt-in material hooks (aero binds these alongside the structural selectors) |
| `.section-title` | Section header lettering |
| `.reveal-unit` | One char/word of a streamed message |

---

## 5. How to add skin #4

Four mandatory steps. Everything else is optional decoration.

1. **`src/renderer/src/theme/themes/<id>/tokens.ts`** exporting a `ThemeTokens`
   object. Fill in every field — TypeScript enforces it, so a missing token is a
   compile error rather than a coverage gap.
2. **`src/renderer/src/theme/themes/<id>/Effects.tsx`** with a default export
   taking `EffectsProps`. Return `null` if the skin has no ambient layer.
3. **One entry in `THEMES`** in `theme/registry.ts`. `satisfies Record<string, Theme>`
   type-checks it and `ThemeId` derives from the keys, so the selector,
   persistence validation and keyboard navigation all pick it up for free.
4. **Add the skin's window background to `THEME_BACKGROUNDS` in `src/main/index.ts`.**
   Miss this and the window flashes the wrong colour for one frame on every
   launch. This is the step people forget.

Optional: a scoped CSS file (`html[data-theme='<id>'] { … }`) **imported from the
skin's `tokens.ts`**, not from `globals.css`; a `watermark`; a `frame`; custom
`@keyframes` named by `textReveal.animation`.

### Things that will bite you

- **A `var()` inside `@keyframes` takes the animation off the compositor.** The
  value has to be resolved in style every frame. Use literal values and express
  variety through several named keyframes plus per-element duration/delay.
- **Legacy aliases are inline on `<html>`** and cannot be overridden from CSS.
  Route anything a skin must control through a real token.
- **Token values must be hex or `rgb()/rgba()`** to get an `--rgb-*` triplet.
- **A light skin must set `state.tint` to its own dark ink.** White tints are
  invisible on light surfaces — this is the single most common coverage bug.
- **`backdrop-filter` budget is four large blurred surfaces.** Fake glass on
  small repeated elements with a pre-baked gradient.
- **Measure contrast, don't eyeball it.** `docs/` has no tooling for this, but
  the technique used for Aero was: hide a text element's ink, screenshot its
  exact rect, average the real pixels, compute WCAG against the computed colour.

---

## 6. Ambient layer performance contract

Applies to every skin's `Effects` component.

- Animate **only** `transform` and `opacity`.
- `will-change` on animating children only, never on the full-viewport root.
- Fixed node pool; never create/destroy per particle.
- `prefers-reduced-motion` **and** the in-app setting freeze the layer to a
  *static composition* (`animation-play-state: paused` with negative delays), not
  to a hidden or reset one.
- Pause entirely when the window is blurred (`motionProfile.pauseOnBlur`).

Measured for `aero` (34 bubbles, 2 caustics, 1 bloom, settings panel open over
the layer, 10s sample): **180 fps average, worst frame 5.8ms, 0 long tasks, 0
frames over 20ms, 0 layouts.** Ambient cost is ~11pp of renderer CPU on a 180Hz
display over a ~25% baseline that is the app's own THREE.js orb; cost scales
roughly 0.4pp per bubble.

Note: one style recalculation per frame appears whenever *any* CSS animation is
running, including a single opacity fade. It is not evidence of a
non-composited animation — don't chase it.

---

## 7. Change log

- **2026-08-08** — Created during the Phase 0 audit for Frutiger Aero. Then:
  56 hardcoded colour values tokenized (`docs/SKIN_COVERAGE.md`), 24 tokens
  added, Tailwind's `colors` block repointed at tokens, the orb given a colour
  API derived from accent tokens, `STATE_COLORS` made token-driven, and the
  `aero` skin added.
