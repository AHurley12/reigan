# Skin Contract

The permanent reference for how skinning works in Shingan, and what it takes to add
a new one. If the code and this document disagree, one of them is a bug.

Terminology: the product calls them **skins**; the code calls them **themes**. The
registry ids are `shingan` (product name "Shingan"), `gothic` ("Sepulchral"),
`aero` ("Frutiger Aero") and `sakura` ("Yozakura"). This document uses the code's
names, since those are what you type.

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
| `html[data-theme='…']` CSS | `themes/gothic/{ornament,signature}.css`, `themes/aero/{aero,ambient}.css`, `themes/sakura/sakura.css` | Material and decoration a token can't express. Scoped in CSS, invisible to components. |
| `EffectsProps.activity` read in JS | `themes/sakura/Effects.tsx` | The assistant's state, so an ambient layer can double as a status display. It is data, like `textReveal`; the layer never learns which skin it is. |

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

| Token | CSS var | `shingan` | `gothic` | `aero` | `sakura` |
| --- | --- | --- | --- | --- | --- |
| `surface.base` | `--surface-base` | `#0B0A08` | `#0A0B0F` | `rgba(127,212,245,0)` | `#14121A` |
| `surface.raised` | `--surface-raised` | `#16140F` | `#16181F` | `rgba(255,255,255,0.40)` | `#1E1B24` |
| `surface.overlay` | `--surface-overlay` | `#1E1B15` | `#1D2029` | `rgba(255,255,255,0.55)` | `#272231` |
| `surface.sunken` | `--surface-sunken` | `#272319` | `#06070A` | `rgba(11,110,150,0.16)` | `#0E0C12` |
| `surface.scrim` | `--surface-scrim` | `rgba(11,10,8,0.7)` | `rgba(6,7,10,0.72)` | `rgba(6,62,86,0.44)` | `rgba(10,9,14,0.72)` |
| `surface.glossTop` | `--surface-gloss-top` | `rgba(237,230,214,0.04)` | `rgba(198,195,186,0.10)` | `rgba(255,255,255,0.24)` | `rgba(232,223,214,0.045)` |
| `surface.glossBottom` | `--surface-gloss-bottom` | `rgba(0,0,0,0.10)` | `rgba(0,0,0,0.30)` | `rgba(201,221,232,0.08)` | `rgba(0,0,0,0.16)` |
| `surface.glassTint` | `--surface-glass-tint` | `rgba(0,0,0,0)` | `rgba(10,11,15,0.55)` | `rgba(244,251,255,0.40)` | `rgba(30,27,36,0.55)` |
| `surface.glassBlur` | `--surface-glass-blur` | `0px` | `10px` | `9px` | `8px` |
| `text.primary` | `--text-primary` | `#EDE6D6` | `#ADABA3` | `#06303F` | `#E8DFD6` |
| `text.secondary` | `--text-secondary` | `#B5AB98` | `#87827A` | `#134B60` | `#B8ACA2` |
| `text.muted` | `--text-muted` | `#6B6455` | `#524F49` | `#234657` | `#94888D` |
| `text.inverse` | `--text-inverse` | `#0B0A08` | `#0A0B0F` | `#F4FBFF` | `#14121A` |
| `text.accent` | `--text-accent` | `#E0A54A` | `#8C2B3B` | `#0B6E96` | `#F0B9C4` |
| `text.kanji` | `--text-kanji` | `#8A8065` | `#87827A` | `#234657` | `#B0A0A6` |
| `text.onAccent` | `--text-on-accent` | `#FFFFFF` | `#E8E4DA` | `#FFFFFF` | `#1A1016` |
| `text.onGlass` | `--text-on-glass` | `#EDE6D6` | `#ADABA3` | `#06303F` | `#E8DFD6` |
| `accent.primary` | `--accent-primary` | `#D8432A` | `#6E1423` | `#16A8D8` | `#E39AA8` |
| `accent.secondary` | `--accent-secondary` | `#23A18C` | `#4A6656` | `#8FD400` | `#6E8560` |
| `accent.danger` | `--accent-danger` | `#E5484D` | `#9E2A3D` | `#D9452F` | `#DC4B4B` |
| `accent.success` | `--accent-success` | `#23A18C` | `#4A6656` | `#8FD400` | `#7E9970` |
| `accent.gradient` | `--accent-gradient` | 135° shu→gold | 135° oxblood→verdigris | 180° gloss, hard terminator | 135° lantern rose→ember |
| `chart.series1` | `--chart-series1` | `#C83D22` | `#C73751` | `#0275A3` | `#D8508F` |
| `chart.series2` | `--chart-series2` | `#BA8C01` | `#0BAA7C` | `#5A8B00` | `#42A228` |
| `chart.series3` | `--chart-series3` | `#07957C` | `#197AE3` | `#AC1C0F` | `#936DE9` |
| `border.subtle` | `--border-subtle` | `rgba(237,230,214,0.07)` | `rgba(173,171,163,0.08)` | `rgba(6,62,86,0.14)` | `rgba(232,223,214,0.075)` |
| `border.strong` | `--border-strong` | `rgba(237,230,214,0.14)` | `rgba(173,171,163,0.16)` | `rgba(6,62,86,0.28)` | `rgba(232,223,214,0.15)` |
| `border.focus` | `--border-focus` | `#23A18C` | `#C1495B` | `#16A8D8` | `#C4707E` |
| `state.tint` | `--state-tint` | `#FFFFFF` | `#FFFFFF` | `#06303F` | `#FFFFFF` |
| `state.selected` | `--state-selected` | `rgba(255,255,255,0.10)` | same | `rgba(22,168,216,0.24)` | `rgba(227,154,168,0.16)` |
| `state.disabledOpacity` | `--state-disabled-opacity` | `0.4` | `0.4` | `0.45` | `0.4` |
| `edge.highlight` | `--edge-highlight` | `transparent` | `rgba(198,195,186,0.16)` | `rgba(255,255,255,0.9)` | `rgba(232,223,214,0.09)` |
| `edge.shadow` | `--edge-shadow` | `transparent` | `rgba(0,0,0,0.55)` | `rgba(11,110,150,0.22)` | `rgba(0,0,0,0.45)` |
| `bevel.outer` | `--bevel-outer` | `0 8px 24px /0.45` | `0 8px 24px /0.6` | `0 8px 24px rgba(6,62,86,0.26)` | `0 10px 30px /0.5` |
| `bevel.inner` | `--bevel-inner` | faint top lining | silver lining | white top + water underside | faint lantern lining |
| `bevel.pressed` | `--bevel-pressed` | `none` | `none` | inset 2px 6px | `inset 0 2px 6px` |
| `bevel.cast` | `--bevel-cast` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.5)` | `rgba(6,62,86,0.24)` | `rgba(0,0,0,0.45)` |
| `sheen.angle` | `--sheen-angle` | `180deg` | `180deg` | `180deg` | `180deg` |
| `sheen.specular` | `--sheen-specular` | `transparent` | `transparent` | `rgba(255,255,255,0.60)` | `rgba(232,223,214,0.12)` |
| `ambient.layerOpacity` | `--ambient-layer-opacity` | `0` | `1` | `1` | `1` |
| `ambient.layerBlend` | `--ambient-layer-blend` | `normal` | `normal` | `normal` | `normal` |
| `ambient.layerZ` | `--ambient-layer-z` | `0` | `0` | `-1` | `0` |
| `focus.glow` | `--focus-glow` | `none` | `none` | `0 0 0 4px rgba(22,168,216,0.30)` | `0 0 0 3px rgba(196,112,126,0.26)` |
| `effect.glow` | `--effect-glow` | shu glow | oxblood glow | aqua glow | rose glow |
| `effect.noiseOpacity` | `--effect-noise-opacity` | `0` | `0.04` | `0` | `0.035` |
| `effect.texture` | `--effect-texture` | `none` | `none` | `none` | `none` |

**Chart series are measured, not chosen.** `chart.series1..3` are the categorical
slots a chart assigns *by identity* — series 1 is always the same metric, so
changing a filter or a date range never repaints the survivors. They are not
aliases of `accent.*` and must never be replaced by `--status-*`: a status colour
asserts that a series is healthy or failing, which the chart never claimed, and
three accents picked to sit under body text routinely collapse into each other
under colour-vision deficiency.

Every triad above passes five computed checks against **that skin's own chart
surface** (`surface.raised`): the OKLCH lightness band, a chroma floor, simulated
protan/deutan/tritan separation over all pairs, unsimulated separation, and WCAG
contrast. The trick that makes them pass is a deliberate **lightness stagger**
between the warm slots — CVD flattens hue but leaves lightness intact, so a red
and a gold at equal lightness are one colour to a deuteranope. `aero` runs darker
than the rest because it is the only light skin and its contrast is measured
downward.

If you change a value here, re-run the check rather than eyeballing it; a triad
that "looks fine" is exactly how the failing ones got written. The renderer that
consumes these is `components/Automations/ChannelTrends.tsx`.

**`ambient.layerZ` is load-bearing.** `0` puts the ambient layer above in-flow
content — right for a sparse dark overlay (fog, embers). `-1` puts it behind
everything — required for a bright full-bleed ground, and it only works if the
skin's `surface.base` is transparent and its surfaces are translucent.

### 4.2 Geometry, type, motion

| Token | `shingan` | `gothic` | `aero` | `sakura` |
| --- | --- | --- | --- | --- |
| `radius.sm/md/lg/pill` | `6/8/12/999px` | `3/6/10/999px` | `5/9/13/999px` | `2/4/6/999px` |
| `space.xs…xl` | `8/16/24/32/48px` | `4/8/16/24/40px` | `8/16/24/32/48px` | `8/16/28/40/64px` |
| `type.display` | Rajdhani | Cormorant Garamond | Frutiger → Segoe UI | Shippori Mincho |
| `type.body` | Inter | IBM Plex Sans | Frutiger → Segoe UI | Zen Kaku Gothic New |
| `type.mono` | JetBrains Mono | IBM Plex Mono | Consolas | M PLUS 1 Code |
| `type.kanji` | Zen Kaku Gothic New | Yu Mincho | Meiryo | Zen Kaku Gothic New |
| `type.seal` | Shippori Mincho B1 | Cormorant Garamond | Segoe UI | Shippori Mincho |
| `type.scale.*` | 12/14/16/20/28/44px | same | same | same |
| `type.weight` | 400/500/700 | 400/500/600 | 400/600/700 | 400/500/700 |
| `type.tracking` | `-0.01em/0/0.06em` | `-0.01em/0/0.08em` | `-0.005em/0/0.045em` | `-0.01em/0/0.1em` |
| `motion.duration fast/base/slow` | 120/200/300ms | 150/240/420ms | 140/220/340ms | 160/260/420ms |

> `radius.lg` must match the RADIUS constant in a skin's `frame.ts` if it ships
> a nine-slice frame, or the moulding stops tracking the edge of the box.

> **`space.*` is declarative only.** Nothing in the app reads `var(--space-*)`
> today — padding comes from Tailwind utilities, and unlike `colors`,
> `fontFamily` and `borderRadius`, the `spacing` scale is *not* wired through
> custom properties in `tailwind.config.ts`. A skin that wants a different
> rhythm cannot get one from these tokens; sakura carries its editorial spacing
> typographically (line-height and tracking) instead. Wiring Tailwind's spacing
> scale to the tokens would fix this for every skin at once, and is the obvious
> next move if a skin ever needs real margin control.

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
| `Effects` | yes | `React.lazy` ambient layer, receives `{ reducedMotion, paused, activity }` |
| `previewGradient` | yes | Static swatch for the selector |

> **`EffectsProps.activity`** (added with sakura) carries the current
> `ReiganState` — `idle | listening | processing | speaking | error | success` —
> so a skin may treat its atmosphere as a status display. `EffectsLayer`
> subscribes to `appStore` once and passes it to whichever layer is mounted;
> skins are free to ignore it, and the three that predate it do.
>
> A layer that uses it **must hold the value in a ref**, not in its effect's
> dependency array. A state change has to retarget the animation, never tear
> down and restart the RAF loop — see `themes/sakura/Effects.tsx`, where the
> response is also eased over ~800ms so the field turns rather than cuts.

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

## 5. How to add skin #5

Four mandatory steps. Everything else is optional decoration. Sakura was built
against exactly this list and needed nothing outside it except the shared
`EffectsProps.activity` field in §4.3 — which was a new *capability* for every
skin, not a special case for one.

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
- **Look at generated artwork before you trust it.** Both procedural figures in
  this app shipped only after being rendered and inspected. Sakura's branch
  passed type-check and build while emitting path data as bare text with no
  `<path>` wrapper — a valid, entirely invisible SVG — and its second draft
  rendered as crossed sticks with asterisks for flowers. Neither is a failure a
  compiler or a test can see.
- **A Japanese type system does not have to cost megabytes.** Google's JP
  webfonts arrive as ~120 frequency-clustered unicode-range subsets; bundling
  the ones covering this app's own labels came to 5.7 MB across 453 files.
  Subsetting the upstream TTFs to the exact glyphs the chrome renders gives the
  same coverage in 346 KB across 7 (`themes/sakura/fonts.css` documents the
  cut). Arbitrary runtime text falls back to system JP faces.

---

## 6. Ambient layer performance contract

A skin has two ambient surfaces and they answer different questions.

| | `Effects` | `particles` |
|---|---|---|
| Where | one full-viewport fixed layer | inside the nav rail and `<main>` |
| Stacking | `ambient.layerZ`: `0` over content, `-1` under it | always under the host's children, over its background |
| Owns | canvas, RAF, resize | nothing — the host owns all lifecycle |
| Good for | weather over the window: fog, mist, vignette, a ground | particles that belong *on* a panel |

`layerZ: -1` only works for a skin whose surfaces are transparent (aero), since
any opaque panel hides it. A region field has no such requirement: a `z-index:
-1` canvas inside a `.particle-host` (which forces a stacking context) paints
after the host's own background and before every child, so it lands on an opaque
rail without touching the palette. That is the whole reason the surface exists.

Two rules come with it. A `.particle-host` must not clip — the rail's tooltips
open across the gutter — so the canvas rounds itself with `border-radius:
inherit`. And a host that creates a stacking context traps its children's
z-index, so a host whose content overflows onto a *later* sibling needs
`.particle-host-raised` or its tooltips paint underneath.

Fields never schedule themselves. `RegionParticles` owns DPR, measurement
(`ResizeObserver`, because these boxes also change when the orb column toggles),
the reduced-motion still frame and the blur pause; `particles/driver.ts` runs
**one** RAF for every field on screen and stops itself when the last unsubscribes.
Volume is derived from host area against `motionProfile.maxParticles`
(`countForArea`/`regionBudget`), so a maximised window carries more than a narrow
one and the rail always carries less than the chat, with no theme hardcoding a
number a resize invalidates.

### Applies to every skin's `Effects` component.

- Animate **only** `transform` and `opacity`.
- `will-change` on animating children only, never on the full-viewport root.
- Fixed node pool; never create/destroy per particle.
- Reduced motion freezes the layer to a *static composition*
  (`animation-play-state: paused` with negative delays), not to a hidden or
  reset one.
- Whether motion is reduced is the `motion` setting resolved against
  `prefers-reduced-motion` — see `hooks/motionPreference.ts`. It is a tri-state
  (`system` / `reduce` / `full`), **not** a boolean OR-ed with the media query:
  that older shape could only ever add reduction, so on a machine with "show
  animations" turned off every ambient layer in the app was permanently frozen
  and the in-app control did nothing.
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

- **2026-08-14** — `reducedMotion: boolean` became `motion: MotionPreference`
  (`system` / `reduce` / `full`), with the resolution split into a tested pure
  function. The old setting was OR-ed with `prefers-reduced-motion`, so it could
  only ever *add* reduction: on a machine with Windows' "show animations" off,
  every ambient layer was frozen with no in-app way to run it and a toggle that
  visibly did nothing.

- **2026-08-14** — Region particle fields added (`theme/particles/`), a second
  ambient surface that paints inside the nav rail and `<main>` beneath their
  content. `shingan` gets the field it never had: orange discharge that runs
  along the panel seams rather than across the middle, so the frame reads as
  energised instead of as weather. `gothic`'s ash motes stopped rising over the
  window and became grey dust and black soot falling inside the panels, leaving
  only genuine atmosphere (fog, vignette, bat) in its `Effects`. `sakura`'s
  petals moved wholesale to a field so they fall *behind* the UI, keeping the
  activity swirl — now aimed at the module area's own centre — and leaving the
  mist behind at 30fps, since that rate existed for the petals. `aero` was left
  alone: its bubbles already rise behind every surface on the compositor, and
  re-cutting them as canvases would have put them on the main thread to fix a
  stacking problem that skin does not have.

  Two things were built and cut after looking at them. Shingan's arcs originally
  jumped corner to corner a sixth of the time; side by side with the seam runs
  it was plainly wrong twice over — a bright diagonal through the column of text
  the panel exists to hold, and generic lightning in place of a specific idea.
  Gothic's soot was first drawn true black with a lit rim, which on `#0A0B0F`
  rendered every flake as a tiny hollow wireframe box; it is warm charcoal now,
  and what separates it from the dust is material, not blackness.

- **2026-08-11** — `sakura` ("Yozakura") added, completing the three alternates
  the original theme-engine spec called for. Built as night hanami rather than
  the spec's daylight washi ground: aero is the app's light skin, and a petal
  system only works as an emissive mark, not a subtractive one. Shipped with a
  procedural sumi-e branch watermark, a locally-subset three-family Japanese
  type system, and `EffectsProps.activity` — a new shared capability letting any
  ambient layer read the assistant's state, which is what makes sakura's petals
  a status display. Measured WCAG: `text.primary` 14.11/12.90,
  `text.secondary` 8.36/7.65, `border.focus` 5.27/4.82 (base/raised).
- **2026-08-08** — Created during the Phase 0 audit for Frutiger Aero. Then:
  56 hardcoded colour values tokenized (`docs/SKIN_COVERAGE.md`), 24 tokens
  added, Tailwind's `colors` block repointed at tokens, the orb given a colour
  API derived from accent tokens, `STATE_COLORS` made token-driven, and the
  `aero` skin added.
