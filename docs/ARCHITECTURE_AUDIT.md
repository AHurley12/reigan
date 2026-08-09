# REIGAN — Architecture Audit

Produced in Phase 0 of the Dev Tools build, before any feature code was written.
Everything below was read from the tree at commit `f9c845f`; nothing here is
inferred from the docs.

The short version: the process model is sound and the AI tool loop already
exists, so the Dev Tools tab has real foundations to build on. Two things are
genuinely wrong and must be fixed before features land — **secrets are stored
and transmitted in plaintext**, and **there is no migration system**, only a
schema file that is duplicated inline and applied with `CREATE TABLE IF NOT
EXISTS`. Both are Phase 1 work.

---

## 1. Process architecture

| | |
| --- | --- |
| Main entry | `src/main/index.ts` |
| Preload | `src/preload/index.ts` (+ `authBridge.ts`) |
| Renderer | `src/renderer/src/**`, React 18 + Zustand + Tailwind |
| Bundler | electron-vite 2.3, three-target config (`electron.vite.config.ts`) |

`src/main/index.ts:53-60`:

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true,
  nodeIntegration: false,
  ...
}
```

- **`contextIsolation: true`** ✅
- **`nodeIntegration: false`** ✅
- **No `enableRemoteModule` / `@electron/remote` anywhere** ✅
- **`sandbox: false`** ⚠️ — see defect D5.

Preload uses `contextBridge.exposeInMainWorld('reigan', api)` — a single
hand-written, namespaced API object. There is no blanket `ipcRenderer` exposure.
That is the correct shape and I will extend it rather than replace it.

Main-process subsystems already present: LLM/agent (`agents/`), voice pipeline
(`voice/`, `voiceAuth/`), Google OAuth (`auth/`), file indexer (`files/`),
perf monitor (`perf/`), SQLite (`db/`).

**Verdict: no Phase 1 remediation needed on process isolation.** The one soft
spot (`sandbox: false`) is a deliberate-looking tradeoff, not a break.

---

## 2. IPC pattern

**Convention: named channels, centrally declared, invoked through a namespaced
preload facade.**

- All channel names are string constants on a single frozen `IPC` object in
  `src/shared/types.ts:227-289` (`as const`). ~50 channels today.
- Request/response uses `ipcRenderer.invoke` / `ipcMain.handle`.
- Fire-and-forget uses `ipcRenderer.send` / `ipcMain.on` (window controls, audio
  chunks, permission responses).
- Main→renderer push uses `webContents.send`, and the preload wraps each one in
  an `on…(callback)` subscriber that **returns an unsubscribe function** — a good
  pattern, consistently applied.
- Handlers are grouped one file per domain in `src/main/ipc/`, each exporting a
  `register…Handlers()` called from `index.ts:126-139`. Registration order is
  load-bearing and commented (voice auth last, because it locks the session).

**This is the convention the capability layer will follow**: one new channel
constant `CAPABILITY_INVOKE` on the `IPC` object, one `registerCapabilityHandlers()`
in `src/main/ipc/`, one `capabilities` namespace on the preload API.

Gap: **no shared validation layer.** Handlers destructure renderer-supplied
params and use them directly. Some paths validate (`files:read-content` →
`isPathAllowed`), most do not (`settings:set` accepts any key/value). See D4.

---

## 3. Persistence

- **Library: `better-sqlite3` ^11** (synchronous). Chosen deliberately — main
  reads the persisted theme synchronously before window creation to avoid a
  flash of the wrong theme (`index.ts:120-123`). Keep it.
- **DB file:** `app.getPath('userData')/reigan.db`, WAL mode, `foreign_keys = ON`.
- **Migration system: none.**

`db/database.ts:16-24` reads `schema.sql` off disk at boot and `exec()`s it. On
any read failure it silently falls back to `runInlineSchema()` — **a second,
hand-duplicated copy of the same DDL in the same file.**

### Current schema

| Table | Purpose |
| --- | --- |
| `tasks` | id, title, description, status(backlog/active/review/done), priority, due_date, created_at, updated_at, completed_at, tags |
| `conversations` | id, title, created_at, updated_at |
| `messages` | id, conversation_id→conversations, role, content, timestamp |
| `settings` | key TEXT PK, value TEXT — **flat KV, plaintext** |
| `files_index` | path UNIQUE, name, dir, ext, size, mtime, is_dir, indexed_at |
| `files_fts` | FTS5 external-content mirror of `files_index.name`, kept by 3 triggers |

No `schema_version` table. Every statement is `CREATE TABLE IF NOT EXISTS`,
which means **there is currently no way to alter an existing table on an
installed database.** See D2.

---

## 4. AI tool-calling

**Yes — it already exists, and it is more complete than the brief assumes.**

- `src/main/agents/reigan.ts` — LangChain `AgentExecutor` + `createToolCallingAgent`
  over `ChatAnthropic`, `maxIterations: 5`, streaming via `streamEvents` v2.
- Tools are `DynamicStructuredTool` instances with **zod schemas already**
  (`zod@3.25.76` is present as a LangChain transitive dep). Example:
  `agents/tools/fileTools.ts:17-20`.
- Tool list is assembled by hand in `getTools()` (`reigan.ts:29-45`), with
  Google tools conditionally appended only when an OAuth client exists.
- **Results are returned to the model as plain formatted strings.** Errors are
  returned as prose (`"Could not list that folder: …"`), not as a structured
  failure. No discriminated union, no machine-readable error signal.
- **An approval gate already exists** and is well built:
  `agents/permissionGate.ts` sends `AGENT_PERMISSION_REQUEST` to the renderer,
  parks a promise in a `Map`, and **auto-denies after 120 s** — exactly the
  timeout Phase 1B specifies. `tools/permission.ts` wraps it as `withPermission()`.

**Implication for Phase 1:** I am not building the tool loop or the approval
timeout from scratch. I am building the *registry* that generates the tool list
instead of hand-maintaining it, and generalising the existing permission gate
into the approval framework (risk tiers, persisted decisions, blast radius,
typed confirmation). This is a refactor of working code, not a greenfield build,
which is the lower-risk path and preserves the existing UI approval card.

Two things to fix while there: `maxIterations: 5` is too low for multi-step dev
work, and the tool list is rebuilt only when the executor is rebuilt
(`resetExecutor()`), so newly-registered capabilities need a cache bust.

---

## 5. Tab / navigation system

**Two-part, half a registry.**

- `NAV_ITEMS` in `src/shared/constants.ts` is a data-driven list (id, en, ja,
  romaji, icon-name) that `NavBar.tsx:38-50` maps over. Icons resolve through an
  `ICON_MAP` string→node lookup. **`dev` and `automations` already have nav
  entries and `AppModule` union members** (`shared/types.ts:3`).
- **But rendering is a hardcoded `switch`** in `AppShell.tsx:59-76`, with `dev`
  and `automations` falling through to a shared `PlaceholderModule` "Coming
  soon" card (`AppShell.tsx:17-46`).

The genuine registry pattern the brief refers to is
`Settings/settingsRegistry.ts` — a `SettingsTab[]` of `{id, labelEn, labelJa,
icon, component}` with the comment *"add one entry here. That's the whole
registration step."* The Dev Tools sub-sections will use exactly this shape.

Plan: swap the `AppShell` switch for a module registry mirroring
`settingsRegistry`, with `React.lazy` components so Dev Tools does not enter the
cold-start bundle. This also directly serves the Phase 8 lazy-mount requirement
and the ≤200 ms cold-start budget.

---

## 6. Existing task system

**Yes — usable as-is by the Automations prompt.**

- Table `tasks`, typed `Task` in `shared/types.ts:28-39`.
- Full CRUD in `db/queries.ts:7-105` (`createTask`, `getTaskById`, `listTasks`,
  `updateTask`, `deleteTask`), IPC in `ipc/tasks.ts`, agent tools in
  `agents/tools/taskTools.ts` (5 tools), Zustand store `stores/taskStore.ts`,
  UI `components/Tasks/`.
- Status enum `backlog|active|review|done`, priority `low|medium|high|critical`,
  `due_date`, `tags` as a JSON array column.

Missing for automations: no recurrence, no scheduling/trigger fields, no
parent/child links. Those are additive columns — which is precisely what the
absent migration system currently blocks (D2).

---

## 7. Secrets handling

**This is the worst finding in the audit.**

- **`safeStorage` is not used anywhere in the app.** The single grep hit is
  `voiceAuth/crypto.ts`, which is a separate, unrelated scheme for voiceprint
  data.
- Every credential lives as a **plaintext row in `settings`**:
  `anthropicApiKey`, `deepgramApiKey`, `elevenLabsApiKey`, `googleClientId`,
  `googleClientSecret` (`shared/types.ts:42-67`), plus the full **Google OAuth
  token set including the refresh token**, JSON-stringified under `googleTokens`
  (`auth/googleAuth.ts:9,46,91,93`).
- **`getAllSettings()` returns the entire settings table to the renderer**
  (`db/queries.ts:165-169` → `IPC.SETTINGS_LOAD_ALL` → `settingsStore.ts:30`).
  Every API key and the Google refresh token are loaded into renderer memory at
  startup.
- The masking in `ApiKeyField.tsx:31-33` is **cosmetic only** — it renders bullets
  over a value the renderer already holds in the clear, in a plain
  `<input type="text">`.

Anyone with read access to `%APPDATA%/reigan/reigan.db` has every key. Anyone
with a foothold in the renderer (a compromised npm dep in the React tree is the
realistic vector) has them too.

---

## Defects and recommendations

Ordered by severity. D1–D3 are Phase 1 blockers.

### D1 — Secrets stored and transmitted in plaintext · **critical**
As section 7. Ciphertext-at-rest via `safeStorage` plus a renderer boundary that
only ever sees masked previews.

> **Recommendation.** Introduce `main/secrets/secretStore.ts` as the sole
> accessor. Encrypt with `safeStorage.encryptString`, store base64 ciphertext in
> a new `secrets` table (not `settings`), decrypt in main only at point of use.
> Change `SETTINGS_LOAD_ALL` to strip secret keys and return `{hasValue, last4}`
> previews. Migrate existing plaintext rows on first boot, then null them out.
> **Note this is a behaviour change to existing features** (voice, Google, LLM
> all read these keys) — it must be done carefully, and it is why I am doing it
> in Phase 1 rather than bolting the vault on later.

### D2 — No migration system; schema duplicated in two places · **high**
`CREATE TABLE IF NOT EXISTS` cannot alter an installed DB, so no shipped table
can ever gain a column. The inline copy in `database.ts:29-104` is a verbatim
duplicate of `schema.sql` that will silently drift.

> **Recommendation.** Build the numbered forward-only migration runner from
> Phase 1C. Migration `001` is the current schema verbatim, baselined so
> existing installs are marked applied without re-running. Delete
> `runInlineSchema()`; bundle migrations as imported string modules so the
> `readFileSync(__dirname)` fragility disappears with it.

### D3 — Silent fallback masks a bundling failure · **high**
`database.ts:18-24` catches *all* errors from reading `schema.sql` and silently
runs the inline copy. A packaging regression that drops `schema.sql` from the
build produces no error — just a divergent schema. Subsumed by D2's fix.

### D4 — No validation boundary on IPC · **high**
Handlers trust renderer input. `settings:set` will write any key. Path-taking
handlers validate inconsistently — `files:read-content` checks `isPathAllowed`,
others do not.

> **Recommendation.** Validation belongs in the capability layer: every
> capability's `inputSchema` parsed with zod in main before the handler runs, on
> both the UI and AI paths. `files/fileIndexer.ts:54-68` already has a correct
> `isPathAllowed` (resolve, case-insensitive prefix check, excluded-segment
> scan) — I will lift that into a shared `pathGuard` rather than write a second
> one.

### D5 — `sandbox: false` · **medium**
Weakens renderer isolation; `contextIsolation` still holds the line. Likely set
for the voice pipeline's preload needs.

> **Recommendation.** Do not change it in this build — flipping it risks the
> voice pipeline for no benefit to Dev Tools. Log it, revisit separately. I am
> calling it out rather than quietly working around it.

### D6 — No audit log of tool invocations · **medium**
Nothing records what the agent did. Phase 1A's `capability_audit` table closes
this for new capabilities; existing tools stay unaudited unless ported.

### D7 — Tool results are unstructured strings · **medium**
Failures come back as prose, indistinguishable from a successful empty result.
A model cannot reliably tell "no projects found" from "the scan crashed".

> **Recommendation.** The `{ok:true,data} | {ok:false,error,recoverable}` union
> from Phase 1A, serialised at the LangChain boundary.

### D8 — `maxIterations: 5` · **low**
Too low for "scan projects, then check ports, then plan a cleanup". Raise to
~15 with the registry work.

### D9 — Hardcoded model id · **low**
`'claude-sonnet-4-6'` is hardcoded at `reigan.ts:50` with a comment about it
being outside `@langchain/anthropic`'s allowlist. Out of scope here; noting it.

---

## Dependencies to add

| Package | For | Note |
| --- | --- | --- |
| `zod` | explicit dep | already present transitively at 3.25.76 — promote to a direct dependency rather than relying on hoisting |
| `fdir` | Phase 2 scanner | fast walker |
| `node-pty` | Phase 5 terminal | **native module** — needs `electron-rebuild` via the existing `postinstall`; highest-risk install in this build |
| `@xterm/xterm` + fit addon | Phase 5 terminal UI | |
| `isomorphic-git` | Phase 2 git metadata | avoids spawning a process per repo |

`node-pty` is the one that can genuinely fail on Windows (it needs a working
node-gyp toolchain). If it will not build I will say so rather than silently
degrading Phase 5 to `child_process.spawn` — that fallback loses interactive
commands and colour, and you should get to make that call.

---

## Baseline measurements

Recorded now so the Phase 9 cold-start comparison has a real "before".

| Metric | Baseline |
| --- | --- |
| `tsc -p tsconfig.node.json --noEmit` | clean, 0 errors |
| `npm run build` | clean, 11.2 s |
| Renderer bundle | **2,497 kB** single chunk (`index-*.js`) |
| Preload bundle | 9.73 kB |
| Cold start — warm cache, median of 3 | **1834 ms** (1834 / 1778 / 1989) |
| Cold start — genuinely cold | 14.9 s – 37.1 s |

Measured with `REIGAN_STARTUP_TRACE=1`, which logs `process.uptime()` at
`ready-to-show` (`main/index.ts`). Instrumented in the shipped code path behind
an env var rather than by hand-editing, so the Phase 9 "after" number comes from
an identical code path.

The genuinely-cold figures (15–37 s) are dominated by Windows Defender scanning
`electron.exe` on first touch and are far too noisy to regression-test against.
**The ≤200 ms Phase 9 budget will be judged against the 1834 ms warm median.**

The 2,497 kB single renderer chunk is the reason Phase 8's lazy mounting is a
correctness requirement and not a nicety: statically importing the Dev Tools
tree into that chunk would spend the entire 200 ms budget before any Dev Tools
code runs. The module registry in section 5 uses `React.lazy` for this reason.
