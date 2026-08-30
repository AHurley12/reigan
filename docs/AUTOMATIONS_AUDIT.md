# Automations Build — Phase 0 Audit

Date: 2026-08-09
Scope: verify the foundations the Automations prompt assumes exist, before writing feature code.

---

## Headline finding

**The Dev Tools build was never run against this repository.** The Automations prompt
opens with "Run this after the Dev Tools prompt. It depends on the capability registry,
approval framework, migration system, and safeStorage secret handling built there" and
instructs me to read `docs/CAPABILITIES.md` and `docs/ARCHITECTURE_AUDIT.md`.

Neither document exists. Neither does the code they would describe:

| Prerequisite | Expected | Actual |
| --- | --- | --- |
| `docs/CAPABILITIES.md` | present | **absent** — `docs/` holds only `SKIN_CONTRACT.md`, `SKIN_COVERAGE.md` |
| `docs/ARCHITECTURE_AUDIT.md` | present | **absent** |
| Capability registry | central registry with risk tiers, dual-surface dispatch, tool-schema generation | **absent** — no registry module anywhere in `src/` |
| Approval framework | write-tier gating, diff preview, risk classification | **partial** — a 47-line permission gate exists; see below |
| Migration system | versioned, ordered migrations | **absent** — schema is an idempotent `CREATE TABLE IF NOT EXISTS` blob |
| safeStorage secret handling | OS-encrypted secrets at rest | **absent** — every secret is plaintext in SQLite |
| Dev Tools tab | built | **absent** — renders a "Coming soon" placeholder |

Git history confirms it: the last five commits are skins, voice, files, and avatar work.
There is no Dev Tools commit.

Everything in Phases 1–9 of the Automations prompt is written against those foundations —
capability IDs, `risk: 'network'` dispatch deferral, write-tier approval with before/after
diffs, the UI-only registry flag that must exclude `usage.getSessions` from the tool schema
generator, and additive migrations for ~25 new tables. **None of that scaffolding is here.**

This is the one decision I will not make unilaterally, because it changes the shape and
size of the build substantially. Options are laid out at the end.

---

## 1. Capability registry — ABSENT

There is no registry. The current architecture has **three parallel, unconnected surfaces**:

1. **IPC handlers** (`src/main/ipc/*.ts`) — 12 modules, each calling `ipcMain.handle`
   directly against a hand-maintained string enum in `src/shared/types.ts` (`IPC`, 58 channels).
2. **Preload bridge** (`src/preload/index.ts`, 7 KB) — hand-written, one method per channel.
3. **Agent tools** (`src/main/agents/tools/*.ts`) — 8 modules of `DynamicStructuredTool`
   instances, hand-assembled into an array in `reigan.ts:getTools()`.

The dual-surface rule the prompt requires ("every capability works through the UI and is
callable by REIGAN as a tool") is currently satisfied by **writing every feature three times**.
`taskTools.ts` and `ipc/tasks.ts` both call `db/queries.ts` independently; they share the
query layer and nothing else. There is no single place where a capability is declared, so
there is nothing to "register everything in" and no id-collision surface to check for
regressions (Phase 10 asks me to verify "the capability registry has no id collisions").

Tool exposure is a hardcoded array plus one conditional:

```ts
// reigan.ts:39 — the only dynamic gating that exists
const googleClient = googleAuth.getClient()
if (googleClient) tools.push(...createCalendarTools(googleClient), ...createEmailTools(googleClient))
```

No risk tiers. No network classification. No UI-only flag. No metadata of any kind.

**Gap: total. The registry must be built before any Automations capability can be registered in it.**

## 2. Approval framework — PARTIAL (~25% of what's needed)

`src/main/agents/permissionGate.ts` + `tools/permission.ts` exist and are sound as far as
they go:

- `withPermission(tool, summary, action, detail?)` wraps a mutating tool call.
- Sends `IPC.AGENT_PERMISSION_REQUEST` to the renderer, awaits a response.
- 2-minute timeout that **auto-denies**, and auto-denies if the window is gone. Correct
  default — an unattended agent turn never sits blocked.

What is missing for the Automations phases:

- **Agent-only.** It is invoked exclusively from LangChain tool bodies. A scheduled job
  firing `youtube.updateVideoMetadata` at 3am has no path to it, and no defined behaviour
  for "approval required but nobody is at the keyboard." This is a design question the job
  engine must answer (my recommendation: write-tier jobs queue an approval into the Phase 6
  notification store rather than auto-denying at 3am).
- **No risk tiers.** Approval is opt-in per call site — an author who forgets `withPermission`
  gets an ungated write with no lint or type error. Phase 2's `youtube.updateVideoMetadata`
  and Phase 5's `calendar.createFocusBlock` need enforcement, not convention.
- **No diff rendering.** `detail` is a flat string. Phase 2 requires a before/after metadata
  diff; Phase 5 requires a rule dry-run preview.
- **No audit trail.** Approvals and denials are not persisted anywhere.

## 3. Migration system — ABSENT, and the current approach blocks this build

`src/main/db/database.ts` opens the DB, then:

```ts
const schemaPath = join(__dirname, 'schema.sql')
try { db.exec(readFileSync(schemaPath, 'utf-8')) }
catch { runInlineSchema(db) }   // a hand-duplicated copy of the same DDL
```

Three problems, in ascending severity:

1. **The schema is duplicated.** `schema.sql` (76 lines) and `runInlineSchema()` (74 lines)
   are the same DDL maintained by hand in two places. They agree today. They will not
   agree after 25 new tables.
2. **The fallback is the live path in production.** `schema.sql` is not in the electron-vite
   build inputs, so `__dirname` lookup fails in a packaged app and the inline copy is what
   actually runs. The file-based path only works in dev.
3. **`CREATE TABLE IF NOT EXISTS` cannot evolve a table.** It is a no-op against an existing
   table, so adding a column to `tasks` — which Phase 3 needs, to link `content_items` to the
   existing task model — silently does nothing on every machine that already has a DB. There
   is no `user_version` tracking and no `ALTER TABLE` path.

**Gap: total.** Automations adds roughly 25 tables and needs at least one alteration to an
existing one. A versioned migration runner is a hard prerequisite, not a nicety.

## 4. Secret storage — PLAINTEXT (security finding, unprompted)

`db/queries.ts` `setSetting`/`getSetting` write to the `settings` table verbatim. Everything
sensitive is stored unencrypted in `%APPDATA%/reigan/reigan.db`:

- `anthropicApiKey`, `deepgramApiKey`, `elevenLabsApiKey`
- `googleClientId`, `googleClientSecret`
- `googleTokens` — **the full OAuth token blob, including the refresh token**

`safeStorage` is never imported. Anything that can read the user's profile directory has a
live Google refresh token for Calendar and Gmail. The prompt's premise that Dev Tools
"built safeStorage secret handling" is not met.

This matters more after Automations than before: Phase 2 adds YouTube write scope and
Phase 5 adds Gmail draft creation to the same token blob.

## 5. Google integration — WIRED, with two flags

**State: genuinely working.** `src/main/auth/googleAuth.ts` is the better-built part of the
codebase. Loopback OAuth (ephemeral localhost server + system browser), correct choice given
Google's retirement of `oob` and its blocking of embedded webviews. `access_type: 'offline'`,
`prompt: 'consent'`, token-refresh persistence via the client's `tokens` event. `isInvalidGrantError()`
already exists as a helper.

**Current scopes** (`googleAuth.ts:7`) — exactly two:

```
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/gmail.modify
```

Against what Automations needs:

| Scope | Status | Needed by |
| --- | --- | --- |
| `calendar` | ✅ granted (broader than the prompt's `calendar.events` — already sufficient) | Phase 3, 5 |
| `gmail.modify` | ✅ granted | Phase 5 |
| `gmail.send` | ✅ **not requested — and must stay that way** | — |
| `youtube.readonly` | ❌ must add | Phase 2 |
| `yt-analytics.readonly` | ❌ must add | Phase 2 |
| `youtube.force-ssl` | ❌ must add | Phase 2 metadata writes |
| `youtube.upload` | ❌ defer until Phase 3 publish step | Phase 3 |

Phase 10 asks me to "verify the send scope is not even requested." **It is not, today.**
I will add a guard so it cannot be added by accident.

### ⚠️ FLAG 1 — OAuth client publishing status (needs your answer)

I cannot determine this from code; it lives in the Google Cloud Console. But the codebase
already carries a comment that reads like scar tissue from hitting it:

> `googleAuth.ts:150` — *"the stored refresh token was revoked or expired (common for OAuth
> clients left in 'Testing' status, where Google kills refresh tokens after 7 days)"*

If the client is still in **Testing**, every scheduled automation in this build breaks
silently after seven days — the daily YouTube sync, the mail rule pass, the digest, the
cadence check. The job engine will do the right thing (retry, back off, disable, notify),
but the user-visible result is "my automations stopped working" once a week, forever.

**Recommendation: switch the OAuth client to Production in Google Cloud Console before
Phase 2.** With sensitive scopes and an unverified app you will see an "unverified app"
interstitial at consent — click through via *Advanced → Go to (unsafe)*. As the sole user
of your own client that is the correct tradeoff; verification is only required for
distributing to others. Production status is what makes refresh tokens durable.

**I need you to confirm the current status.** If it stays in Testing, I will build the
scheduler to detect `invalid_grant` and raise a re-auth notification rather than letting
jobs fail opaquely — but that is a bandage on a self-inflicted wound.

### ⚠️ FLAG 2 — adding scopes invalidates the existing grant

Adding YouTube scopes forces a fresh consent. The existing token has no YouTube grant and
incremental auth will return a new token blob. Re-connect is required once, and the flow
must handle it gracefully rather than throwing `invalid_grant` at the user. One consent
screen, one token store, as the prompt requires — but one forced re-connect at the boundary.

## 6. Task model — EXISTS, minimal

`tasks` table (`schema.sql:3`):

```
id TEXT PK, title, description, status, priority, due_date,
created_at, updated_at, completed_at, tags (JSON array)
status   ∈ backlog | active | review | done
priority ∈ low | medium | high | critical
```

Full CRUD in `db/queries.ts`, IPC in `ipc/tasks.ts`, agent tools in `taskTools.ts`, a Kanban
UI in `Tasks/TaskPanel.tsx`. Timestamps are epoch **ms** (the `DEFAULT (unixepoch())` in the
DDL says seconds, but every write path passes `Date.now()` — the defaults are dead code, and
the whole codebase is consistently ms. I will match ms, per the prompt's "UTC epoch ms").

**Usable for Phase 3, with one required alteration.** The prompt says content items should
"create and own tasks." There is no ownership column and no foreign-key surface — `tags` is
the only extension point and it is a JSON blob, unindexable and wrong for a relation. I need
to add a nullable owner reference (`source_kind` + `source_id`, or a dedicated
`content_item_id`) to `tasks`. **That is an `ALTER TABLE`, which the current schema system
cannot perform** — see §3. This is the concrete case that makes the migration runner blocking
rather than merely advisable.

**Also absent: the `projects` table.** Phase 5 says "reuse the `projects` table and content
pipeline items so mail relating to a known project gets labeled automatically." There is no
`projects` table in this codebase. It was presumably a Dev Tools deliverable. Phase 5's
project-based labeling will have to key off `content_items` alone, or I build a minimal
projects table.

## 7. Notification surface — HALF PRESENT

**In-app: a toast store exists, and it is not what the Digest needs.**
`stores/toastStore.ts` — Zustand, in-memory, 6-second auto-dismiss, `{id, message, variant}`.
Renderer-only, wiped on reload. No persistence, no source, no priority, no deep link, no
read state, no history. It is a transient error surface and should stay one.

**Native OS notifications: entirely absent.** `Notification` from Electron is never imported
anywhere in `src/`. There is no notification permission handling, no click routing, no app
user model ID set for Windows toast identity (`electronApp.setAppUserModelId` — need to
verify it survives to the packaged build, since Windows silently drops toasts from apps
without a registered AUMID).

**Gap for Phase 6: the entire `notifications`/`digests`/`digest_settings` store, the bell
chrome, quiet hours, priority routing, deep-link navigation, and the native bridge.** The
toast store is a useful neighbour, not a foundation. Deep links also need something that
does not exist: `appStore.setActiveModule` can select a tab but there is no way to address a
*record within* a tab, which Phase 6 requires ("clicking a GitHub event opens that Dev Tools
view"). I will need a small navigation-intent layer.

## 8. Existing scheduled work — three items, one migration candidate

| What | Where | Cadence | Migrate to job engine? |
| --- | --- | --- | --- |
| Perf sampler | `perf/perfMonitor.ts:117` — `setInterval(tick, 2000)` | 2s while the Performance tab is open | **No.** Renderer-lifecycle-bound, stops on tab close, sub-minute. Wrong shape for a durable scheduler. Leave it. |
| File index | `main/index.ts` → `runFullIndex()` | once at boot, fire-and-forget | **Yes.** This is exactly a `catch_up_policy: run_once` job. Currently it is an unobservable boot-time side effect with no failure surface, no history, and no way to see when it last ran. |
| Google token refresh | implicit, inside `googleapis` | on 401 | **No.** Library-internal, event-driven, correct as-is. |

Nothing else runs on a timer. Notably there is **no** periodic mail poll, calendar sync, or
YouTube sync — Mail and Calendar panels fetch on demand. So the job engine is not displacing
an incumbent; it is the first durable scheduler in the app.

`app.on('will-quit')` calls `globalShortcut.unregisterAll()`, `stopMonitoring()`, and
`closeDatabase()` — the shutdown hook the scheduler needs to persist `next_run_at` cleanly
already exists.

## 9. Other gaps found while auditing

- **Missing npm dependencies** — none of the packages the prompt names are installed:
  `cron-parser` (Phase 1), `active-win` (Phase 7), `sharp`, `ffmpeg-static`, `ffprobe-static`
  (Phase 4). `zod` is present (transitively, via LangChain) and is used directly by tool
  schemas; I would rather promote it to a direct dependency than keep relying on hoisting.
- **No perceptual hashing exists.** Phase 4: "reuse the Organizer's implementation — do not
  write it twice." There is no Organizer and no pHash code. It must be written once, here.
- **No Project Scanner exists.** Phase 4: "walk with the same pruning discipline as the
  Project Scanner." The closest analogue is `files/fileIndexer.ts`, which has a usable
  `EXCLUDED_DIR_NAMES` set and dotfile skipping — but it **runs on the main thread**, not in
  a worker. Phase 4 explicitly requires a worker thread, so the asset indexer needs a new
  walker; I will factor the prune predicate out of `fileIndexer.ts` so the rule lives once.
- **No test infrastructure was configured.** `vitest` has just appeared in `devDependencies`
  but there is no config, no `test` script, and no test files. Phase 1's catch-up semantics
  (`run_once` / `run_all` / `skip`, DST boundaries, overlap suppression) are precisely the
  logic that needs unit tests rather than manual verification — I intend to add a vitest
  config and test the schedule maths directly.
- **The nav entry already exists.** `constants.ts:78` already lists `automations` (自動化 /
  *jidouka*) with a `Zap` icon, wired in `AppShell.tsx` to a "Coming soon" placeholder.
  Phase 9's tab registration is mostly replacing that placeholder — cheap.
- **Skin contract is in good shape.** `docs/SKIN_COVERAGE.md` documents a completed pass:
  56 hardcoded colours found, 56 converted, 0 remaining, across 54 components. Three themes
  (`shingan`, `gothic`, `aero`). The Phase 9 requirement of zero hardcoded colours is
  realistic here because the discipline is already established and documented.

---

## Summary table

| Prerequisite | State | Blocking? |
| --- | --- | --- |
| Capability registry | absent | **Yes** — every phase registers into it |
| Approval framework | partial (agent-only, no tiers, no diffs, no headless story) | **Yes** for Phases 2, 5 |
| Migration system | absent, and current DDL cannot alter tables | **Yes** — Phase 3 needs `ALTER TABLE tasks` |
| safeStorage secrets | absent; refresh token in plaintext | No, but should be fixed before adding scopes |
| Google OAuth | working; needs 3–4 new scopes + one re-consent | No |
| OAuth publishing status | **unknown — needs your answer** | **Yes** if Testing |
| Task model | exists, needs one added relation | via migrations |
| `projects` table | absent | Phase 5 partial |
| In-app notifications | toast only — insufficient | Phase 6 builds it |
| Native OS notifications | absent | Phase 6 builds it |
| Deep-link navigation | absent (tab-level only) | Phase 6 |
| Existing scheduled work | 3 found, 1 should migrate | No |
| npm deps | 5 missing | No |
| pHash / Organizer | absent | Phase 4 writes it |
| Worker-thread walker | absent | Phase 4 writes it |
| Nav slot | already present | No |
| Skin tokens | established, documented | No |

---

## Recommendation

The Automations build as specified rests on a Dev Tools foundation that does not exist.
I see three honest paths, and I recommend the second.

**A. Run the Dev Tools prompt first.** Cleanest, matches the intended sequence, and
Automations then lands exactly as written. Cost: a whole separate build before any
Automations feature ships.

**B. Build a "foundations" Phase 0.5 — recommended.** Extract just the four prerequisites
Automations actually needs, build them properly, and let a later Dev Tools build register
into the same registry rather than creating a parallel one:

1. **Capability registry** — id, title, risk tier (`read` / `write` / `network` / `destructive`),
   `uiOnly` flag, zod schema, handler. One declaration generating all three surfaces: IPC
   handler, preload method, LangChain tool. The tool-schema generator excludes `uiOnly` — the
   mechanism Phase 7 requires to keep `usage.getSessions` away from the model.
2. **Migration runner** — `user_version`-based, ordered, transactional, forward-only.
   Existing tables adopted as migration 1 so current databases converge without data loss.
   Deletes the `schema.sql` / `runInlineSchema` duplication.
3. **Approval framework v2** — enforced by risk tier at dispatch rather than by convention
   at the call site, with structured before/after diffs, an audit trail, and a defined
   headless path (queue for approval, do not auto-deny at 3am).
4. **safeStorage secret migration** — encrypt the three API keys, the Google client secret,
   and the token blob; transparent one-time migration of existing plaintext rows.

This is real work but it is *load-bearing* work — items 1 and 2 are hard prerequisites, and
doing item 4 now avoids re-encrypting a token blob that Phase 2 is about to widen with
YouTube write scope.

**C. Build Automations standalone, foundations deferred.** Fastest to a visible YouTube
Manager, and the worst outcome. It means hand-writing three surfaces per capability across
seven features, then unpicking all of it when Dev Tools lands. It also makes Phase 7's
privacy guarantee — "the tool schema generator must exclude `usage.getSessions`" — a promise
enforced by nothing but care, which is not good enough for the feature that logs the user.

**Not recommended.**

---

## Questions before I proceed

1. **Path A, B, or C?** (I recommend B.)
2. **Is the Google OAuth client in Testing or Production?** If Testing, will you switch it
   to Production, or should I build for 7-day token death?
3. **`projects` table** — build a minimal one now, or have Phase 5 key project labeling off
   `content_items` only?
4. **Headless approval semantics** — when a scheduled write-tier job fires unattended, should
   it (a) queue an approval notification and run on your approval, (b) skip and log, or
   (c) run without approval because you scheduled it deliberately? This one materially
   affects what an automation can do while you are asleep, so I would rather ask than assume.
   My recommendation is (a).
