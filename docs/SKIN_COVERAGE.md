# Skin Coverage Manifest

Produced during Phase 1 of the Frutiger Aero build. Exists to eliminate one
specific class of bug: components that quietly keep their old colours because
they were never wired to tokens.

Audited: `src/renderer/src/**` (renderer), plus `src/shared/constants.ts` and
`src/main/index.ts` where they carry per-skin knowledge.

---

## Summary

| | Count |
| --- | --- |
| Components enumerated (walked from `App.tsx`, not from the file listing) | 54 |
| Components fully tokenized **before** this pass | 41 |
| Components with at least one hardcoded value | 21 |
| **Hardcoded colour values found** | **56** |
| **Hardcoded colour values converted** | **56** |
| Hardcoded values remaining | 0 |
| Latent CSS bugs found and fixed while converting | 2 |
| New tokens added to support the conversions | 24 |
| Tailwind `colors` entries repointed at tokens | 16 |

Two of those 21 components appear only in error/empty/loading states, which is
exactly where coverage gaps hide — see the component inventory below.

---

## Component inventory

Walked from the root render tree in `App.tsx`, not from `find`. Conditional
mounts are marked ⚡ and were reached by forcing their state, since they never
appear in a default screenshot.

`ThemeProvider` → `EffectsLayer` → `LockGate` → `AppShell` + `SettingsPanel` + `PerfHud`

| Component | Mount | Before | After |
| --- | --- | --- | --- |
| Shell/AppShell | always | tokenized | tokenized |
| Shell/TitleBar | always | **3 hardcoded** (`bg-white/10` ×3) + STATE_COLORS | tokenized |
| Shell/EffectsLayer | always | tokenized | tokenized |
| Shell/SettingsPanel | ⚡ settings open | **4 hardcoded** | tokenized |
| Shell/PerfHud | ⚡ `VITE_PERF_HUD=true` | **2 hardcoded** | tokenized |
| Nav/NavBar | always | **1 hardcoded** | tokenized |
| Nav/NavItem | always | **3 hardcoded** | tokenized |
| Chat/ChatPanel | ⚡ module = chat | tokenized | tokenized |
| Chat/InputBar | ⚡ module = chat | **4 hardcoded** | tokenized |
| Chat/Message | ⚡ has messages | tokenized | tokenized |
| Chat/StreamingText | ⚡ streaming | tokenized | tokenized |
| Chat/InscribeText | ⚡ streaming | tokenized (reads `theme.textReveal`) | unchanged |
| Tasks/TaskPanel | ⚡ module = tasks | **4 hardcoded** (`bg-white/10`) | tokenized |
| Tasks/TaskList | ⚡ module = tasks | tokenized | tokenized |
| Tasks/TaskCard | ⚡ has tasks | **5 hardcoded** (priority ramp + overdue) | tokenized |
| Calendar/CalendarPanel | ⚡ module = calendar | **5 hardcoded** + 1 invalid-CSS bug | tokenized |
| Mail/MailPanel | ⚡ module = mail | **6 hardcoded** | tokenized |
| Files/FilesPanel | ⚡ module = files | **6 hardcoded** | tokenized |
| Performance/PerformancePanel | ⚡ module = performance | **1 hardcoded** | tokenized |
| Performance/views/ProcessesView | ⚡ | **1 hardcoded** | tokenized |
| Performance/views/{Overview,Disk,Network}View | ⚡ | tokenized | tokenized |
| Performance/shared/{LineChart,Meter,Sparkline,StatTile} | ⚡ | tokenized | tokenized |
| Orb/OrbColumn | ⚡ `showOrbColumn` | tokenized | tokenized |
| Orb/VoiceOrb | ⚡ `showOrbColumn` | **no theme plumbing at all** | reads palette from tokens |
| Orb/AvatarPanel | ⚡ `showOrbColumn` | **2 hardcoded** (incl. error state) | tokenized |
| Lock/LockGate | always | tokenized | tokenized |
| Lock/LockScreen | ⚡ locked | **2 hardcoded** | tokenized |
| Lock/AuthOrb | ⚡ locked | tokenized (reads `theme.tokens`) | unchanged |
| Lock/CircularWaveform | ⚡ locked | tokenized (reads `theme.tokens`) | unchanged |
| Lock/EnrollmentFlow | ⚡ first run | tokenized (reads `theme.tokens`) | glass tokens regrouped |
| Settings/ThemeSelect | ⚡ settings → appearance | tokenized | tokenized |
| Settings/controls/Select | ⚡ | **2 hardcoded** | tokenized |
| Settings/controls/{ApiKeyField,SettingRow,Slider,Toggle} | ⚡ | tokenized | tokenized |
| Settings/tabs/PersonalitySettings | ⚡ | **3 hardcoded** | tokenized |
| Settings/tabs/{General,Appearance,Japanese,Voice,Security,Connections}Settings | ⚡ | tokenized | tokenized |
| shared/Button | ⚡ | **1 hardcoded** (`text-white`) | tokenized |
| shared/Toast | ⚡ toast fired | **1 hardcoded** | tokenized |
| shared/HankoMark | always | **2 hardcoded** | tokenized |
| shared/{FuriganaText,KanjiTooltip,SectionHeader} | ⚡ | tokenized | tokenized |

### Non-component surfaces

| Surface | Before | After |
| --- | --- | --- |
| Scrollbars (`::-webkit-scrollbar*`) | tokenized | tokenized |
| Focus rings (`:focus-visible`) | tokenized (outline only) | + `--focus-glow` |
| **Text selection (`::selection`)** | **not skinned — UA default blue** | tokenized |
| Disabled states | Tailwind `disabled:opacity-*` | unchanged (opacity, skin-independent) |
| Empty states | tokenized | tokenized |
| Loading skeletons / spinners | AvatarPanel spinner hardcoded | tokenized |
| Error states | AvatarPanel + LockScreen hardcoded | tokenized |
| Tooltips (NavItem, InputBar) | NavItem shadow hardcoded | tokenized |
| Dropdowns (Select) | shadow hardcoded | tokenized |
| Drag states | none exist | n/a |
| Context menus | none exist | n/a |

---

## Converted values

Every row was a colour that did not follow the skin. Line numbers are as of the
conversion commit.

### Interaction tints — 22 values

`bg-white/N` reads as "lighter" on a dark skin and as **nothing at all** on a
light one. Replaced with `bg-tint/N`, backed by the `state.tint` token, so the
alpha ratios are preserved exactly while the base colour becomes the skin's.

| File | Lines | Was | Now |
| --- | --- | --- | --- |
| Shell/TitleBar.tsx | 37, 81, 89 | `hover:bg-white/10` | `hover:bg-tint/10` |
| Shell/SettingsPanel.tsx | 87 | `hover:bg-white/10` | `hover:bg-tint/10` |
| Tasks/TaskPanel.tsx | 56, 62, 90, 98 | `bg-white/10` | `bg-tint/10` |
| Calendar/CalendarPanel.tsx | 126, 137 | `hover:bg-white/5` | `hover:bg-tint/5` |
| Mail/MailPanel.tsx | 238, 399, 410, 417 | `hover:bg-white/5` | `hover:bg-tint/5` |
| Files/FilesPanel.tsx | 262, 299, 370, 432, 439 | `hover:bg-white/5` | `hover:bg-tint/5` |
| Performance/views/ProcessesView.tsx | 71 | `hover:bg-white/5` | `hover:bg-tint/5` |
| Settings/controls/Select.tsx | 62 | `hover:bg-white/5` | `hover:bg-tint/5` |
| shared/Button.tsx | 13 | `text-white` | `text-txt-on-accent` |

### Accent washes — 11 values

Alpha preserved exactly via `color-mix`, so the two dark skins are unchanged.

| File | Line | Was | Now |
| --- | --- | --- | --- |
| Files/FilesPanel.tsx | 337 | `rgba(35,161,140,0.14)` | `color-mix(… var(--accent-secondary) 14% …)` |
| Mail/MailPanel.tsx | 258 | `rgba(35,161,140,0.14)` | `color-mix(… var(--accent-secondary) 14% …)` |
| Chat/InputBar.tsx | 62 | `rgba(216,67,42,0.14)` + `rgba(216,67,42,0.35)` | `color-mix` on `--accent-primary` |
| Shell/SettingsPanel.tsx | 48 | `rgba(216,67,42,0.14)` | `color-mix(… 14% …)` |
| Performance/PerformancePanel.tsx | 104 | `rgba(216,67,42,0.14)` | `color-mix(… 14% …)` |
| Nav/NavItem.tsx | 49 | `rgba(216,67,42,0.18)` | `color-mix(… 18% …)` |
| Nav/NavBar.tsx | 59 | `rgba(216,67,42,0.18)` | `color-mix(… 18% …)` |
| Settings/tabs/PersonalitySettings.tsx | 78 | `rgba(216,67,42,0.1)` + `rgba(216,67,42,0.3)` | `color-mix` on `--accent-primary` |
| Tasks/TaskCard.tsx | 37 | `rgba(229,72,77,0.3)` | `color-mix(… var(--accent-danger) 30% …)` |

### Shadows — 7 values

| File | Line | Was | Now |
| --- | --- | --- | --- |
| shared/Toast.tsx | 28 | `0 8px 24px rgba(0,0,0,0.45)` | `var(--bevel-outer)` |
| Settings/controls/Select.tsx | 54 | `0 8px 24px rgba(0,0,0,0.45)` | `var(--bevel-outer)` |
| Nav/NavItem.tsx | 67 | `0 4px 16px rgba(0,0,0,0.4)` | `var(--bevel-outer)` |
| Nav/NavItem.tsx | 51 | `0 0 12px rgba(216,67,42,0.25)` | `color-mix` on `--accent-primary` |
| shared/HankoMark.tsx | 15 | 2 × rgba in one shadow | `color-mix` on `--text-primary` / `--accent-primary` |
| Shell/SettingsPanel.tsx | 34 | `-12px 0 40px rgba(0,0,0,0.4)` | `-12px 0 40px var(--bevel-cast)` |

### Literal colours — 16 values

| File | Line | Was | Now |
| --- | --- | --- | --- |
| Tasks/TaskCard.tsx | 8–11 | `#6B6455` `#5B7A99` `#C9A227` `#E5484D` | severity ramp on `--text-muted` → `--accent-danger` |
| Shell/PerfHud.tsx | 48 | `rgba(0,0,0,0.7)`, `#7CFC9A` | `--surface-scrim`, `--accent-success` |
| Lock/LockScreen.tsx | 338, 348 | `#ff2d55`, `#00e5ff` | `--accent-danger`, `--accent-secondary` |
| Orb/AvatarPanel.tsx | 171 | `var(--critical, #ef4444)` | `var(--critical)` |
| Mail/MailPanel.tsx | 465 | `color: 'white'` | `var(--text-on-accent)` |
| Calendar/CalendarPanel.tsx | 168, 230 | `color: 'white'` | `var(--text-on-accent)` |
| Chat/InputBar.tsx | 103, 124 | `color: 'white'` | `var(--text-on-accent)` |
| Settings/tabs/PersonalitySettings.tsx | 26 | `color: 'white'` | `var(--text-on-accent)` |
| shared/constants.ts | 52–59 | 6 literal hexes (`STATE_COLORS`) | `var(--status-*)`, derived from accents |

### Structural fixes

| Item | What was wrong |
| --- | --- |
| `Orb/engine/colorPresets.ts` | 36 hardcoded hue floats, comment admitting they were "retuned to the Shingan palette". No API existed for a theme to influence the orb — it rendered vermillion/jade/gold under Sepulchral too. Now motion is shared and hue is derived from accent tokens; all five orb styles funnel through this file, so one fix covers them. |
| `tailwind.config.ts` | 16 colour entries were literal hexes, so `bg-elevated` / `text-txt-muted` rendered Shingan's palette under every skin. Repointed at `rgb(var(--rgb-*) / <alpha-value>)`, which preserves the 7 existing opacity-modifier usages (`bg-critical/20`, `border-reigan-primary/50`, …). |
| `theme/applyTokens.ts` | `--text-accent` and `--text-kanji` were in the legacy alias layer, which runs *after* the token flatten and therefore silently overwrote the real tokens. Shingan declared `text.accent: #E0A54A` and rendered jade. Aliases removed; the tokens now own those names. |

### Latent bugs found while converting

1. **`CalendarPanel.tsx:190`** — `background: \`${eventColor(ev.title)}33\``. `eventColor` returns a `var()` reference, so this produced `var(--reigan-primary)33`, which is invalid CSS and dropped the background entirely. Fixed with `color-mix`.
2. **`theme/applyTokens.ts`** — the `--text-accent` alias described above made `shinganTokens.text.accent` dead code.

---

## Known remaining per-skin knowledge

Not coverage gaps, but places a new skin must still be added by hand. Tracked
in `SKIN_CONTRACT.md` §6.

| Item | Why it can't be a token |
| --- | --- |
| `THEME_BACKGROUNDS` in `src/main/index.ts` | The main process sets `BrowserWindow.backgroundColor` before any renderer code runs, and cannot import renderer modules. Step 4 of the add-a-skin checklist. |
| `--space-1…8` in `globals.css` | A second, unthemed spacing scale that duplicates `--space-xs…xl`. Neither is widely used; layout is Tailwind's rem scale. Dead weight, not a gap. |

---

## Post-Aero addendum

Added after the Aero skin landed, since both items were coverage gaps the third
skin exposed:

| Item | Before | After |
| --- | --- | --- |
| `--reigan-gradient` (send button, active mic) | Hardcoded 135° two-stop ramp inside `LEGACY_ALIASES`. Because aliases are written as inline styles on `<html>`, **no stylesheet rule could override it** — a skin wanting a gloss button had no way in. | New `accent.gradient` token; the alias now points at it. Dark skins keep byte-identical values. |
| Ambient layer stacking | `EffectsLayer` hardcoded `zIndex: 0`, which puts the ambient layer *above* in-flow content. Fine for a sparse dark overlay, fatal for a bright full-bleed ground. | New `ambient.layerZ` token. `0` for both dark skins (unchanged), `-1` for Aero. |

### Cut during the Aero build

| Cut | Why |
| --- | --- |
| Grass/leaf silhouette in the ambient layer | Built, rendered, looked at, deleted. The app's panels cover the bottom of the window edge to edge, so a band along the bottom of the ambient layer has no exposed real estate — behind 40% white and a 9px blur it produced nothing but a faint darkening. An invisible element that still costs a raster is worse than no element. |

---

## Dev Tools addendum

Components added by the Dev Tools tab build. Every one was written against
tokens from the start rather than converted afterwards, so the "before" column
that the original audit needed does not apply — the check here is that nothing
reintroduced a hardcoded value.

Verified by grepping the new tree for hex literals, `rgb(`/`rgba(`, and
Tailwind colour utilities (`bg-white`, `text-black`, `border-gray-*`): zero
matches.

| Component | Mount | Tokens used |
| --- | --- | --- |
| DevTools/DevToolsPanel | ⚡ module = dev | `--accent-primary`, `--reigan-primary`, `--text-primary/muted/kanji`, `--bg-elevated` |
| DevTools/devtoolsRegistry | — | no styling (registry only) |
| DevTools/shared/AsyncPane | ⚡ every view, all three states | `--bg-elevated`, `--border`, `--text-primary/secondary/muted`, `--status-critical`, `--accent-primary` |
| DevTools/shared/VirtualList | ⚡ lists > 200 rows | no colour of its own (layout only) |
| DevTools/views/ProjectsView | ⚡ sub-tab = projects | `--status-good/warning/critical` (status ramp), `--bg-elevated`, `--border`, `--border-accent`, `--accent-primary`, `--text-*` |
| DevTools/views/PortsView | ⚡ sub-tab = ports | `--status-warning/critical`, `--bg-elevated`, `--border`, `--text-*` |
| DevTools/views/ShellView | ⚡ sub-tab = shell | `--status-good/warning/critical` (classification tiers), `--bg-elevated`, `--border`, `--border-accent`, `--text-*` |
| DevTools/views/OrganizerView | ⚡ sub-tab = organizer | `--accent-primary`, `--border`, `--border-accent`, `--bg-elevated`, `--status-good`, `--text-*` |
| DevTools/views/VaultView | ⚡ sub-tab = vault | `--status-warning` (secret badge), `--bg-elevated`, `--border`, `--border-accent`, `--text-*` |
| DevTools/views/GitHubView | ⚡ sub-tab = github | `--text-secondary/muted` |

### Notes

**No new tokens were added.** Project activity status (active / warm / dormant
/ abandoned) and shell classification tiers (allow / approval / block) both
reuse the existing `--status-good` / `--status-warning` / `--status-critical`
ramp that the Performance views already use. A parallel palette would have
looked identical on the shipped skins and then drifted the moment a fourth
skin retuned one ramp and not the other.

**Conditional mounts.** Every view here is `⚡` twice over — the tab is
`React.lazy` and each sub-section is too, so none of them appear in a default
screenshot. AsyncPane's error and empty branches need their states forced to
be seen at all, which is exactly where the original audit found coverage gaps
hiding.
