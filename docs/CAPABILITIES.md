# Capabilities

Every privileged operation in REIGAN is declared once, in
`src/main/capabilities/defs/`, and reached through one dispatcher —
`invokeCapability` in `registry.ts`. The UI and the model call the same
handler through the same validation and the same approval gate. There is no
second path.

This is the reference the Automations prompt builds on.

**41 capabilities registered; 28 added by the Dev Tools build.** The rest
(`tasks.*`, `jobs.*`, `files.reindex`) come from the Automations branch.

---

## How dispatch works

```
UI  ──IPC 'capability:invoke'──┐
                               ├─► invokeCapability(id, args, ctx)
model ──LangChain tool────────┘         │
                                        ├─ 1. uiOnly check      (model cannot reach UI-only ids)
                                        ├─ 2. zod validation    (never trust either caller)
                                        ├─ 3. risk resolution   (static, or dynamicRisk(args))
                                        ├─ 4. approval          (write/destructive)
                                        ├─ 5. handler
                                        └─ 6. audit             (always, every outcome)
```

The model's tool array is **generated** from the registry
(`agentTools.ts`), so adding a capability makes it available to REIGAN with
no second edit. Dotted ids are translated to underscores because the
Anthropic API rejects `.` in a tool name.

### Risk tiers

| Tier | Prompts? | Meaning |
| --- | --- | --- |
| `read` | never | Reads local state. |
| `network` | never on its own | Reaches an external service. |
| `write` | yes | Mutates the user's data. |
| `destructive` | yes, and says so more strongly | Irreversible or bulk-destructive. |

**Approval applies to UI clicks too**, by default. The setting
`requireApprovalForAllCapabilities` (default on — an unset value reads as on)
controls this. Turning it off restores "a UI click is its own approval",
which is quieter and correct for a one-line edit, but wrong for *Execute this
plan across 400 files*: dispatch cannot tell those apart, and the risk tier
calls both destructive.

`shell.run` uses `dynamicRisk` to recompute its tier from the parsed command,
so `git status` never prompts while everything else does. It fails closed — a
throwing risk function falls back to the declared tier.

### Results and errors

Handlers return data or throw `CapabilityError(message, code)`. Dispatch
converts both into `{ ok: true, result }` or
`{ ok: false, error, errorCode }`; **no exception crosses IPC**. Codes:
`not_found`, `invalid_args`, `denied`, `offline`, `not_connected`,
`cancelled`, `handler_failed`, `awaiting_approval`.

Errors are written to be read by a person, and the model relays them rather
than inventing success.

### Audit

Every dispatch writes to `capability_audit`: capability id, caller
(`ui`/`agent`/`job`), arguments, outcome, error, duration, timestamp.
Argument values are **redacted by key** (`body`, `value`, `secret`, `token`,
`password`, `apiKey`, `content`, `fields`) before being written — the audit
table is plaintext by design so it stays greppable, which means a vault body
must never reach it.

---

## Code Project Scanner

| id | risk | approval | summary |
| --- | --- | --- | --- |
| `devtools.scanProjects` | read | no | Walk configured roots and index every project. |
| `devtools.listProjects` | read | no | List indexed projects **plus a summary aggregate**. |
| `devtools.getProject` | read | no | Full metadata for one project. |
| `devtools.openProject` | read | no | Open in explorer / editor / terminal. |
| `devtools.scanRoots` | read | no | Which folders are scanned. |

`listProjects` returns a summary alongside the rows so *"how many abandoned JS
projects do I have?"* is one call, not the model counting rows and getting it
wrong.

```jsonc
// devtools.listProjects
{ "status": "abandoned", "language": "TypeScript", "flag": "uncommitted-changes" }
```

Filters: `status` (`active` ≤14d, `warm` 15–60, `dormant` 61–180, `abandoned`
180+), `language`, `framework`, `flag`
(`never-committed` | `no-readme` | `uncommitted-changes` | `unpushed-commits`),
`search`, `limit`.

The scan runs in a **worker thread** (`scanWorker.js`, emitted as its own
rollup entry) and reports progress over `capability:progress`.

**Known limits.** `unpushedCount` compares against `refs/remotes/origin/<branch>`
without fetching — a scan must never touch the network — so it means "unpushed
as of your last fetch", the same thing local git would tell you. Dependency
byte totals are capped at 20,000 stats per project; the un-vendored total,
languages and LOC are always exact.

## Localhost Monitor

| id | risk | approval | summary |
| --- | --- | --- | --- |
| `localhost.scan` | read | no | Listening ports, joined to projects. |
| `localhost.getPort` | read | no | One port in detail. |
| `localhost.openInBrowser` | read | no | Open `http://localhost:<port>`. |
| `localhost.killProcess` | **destructive** | yes | Force-kill the owner of a port. |

```jsonc
{ "probeHttp": false }   // localhost.scan — probe is off by default
```

`killProcess` resolves the process *before* prompting, so the card names what
will die. It refuses anything under a Windows system location, and treats an
**unreadable executable path as protected** — on a non-elevated query that is
exactly what happens for system services.

## Shell

| id | risk | approval | summary |
| --- | --- | --- | --- |
| `shell.run` | destructive → `dynamicRisk` | depends on the command | Run one command, capture output. |
| `shell.classify` | read | no | How would this command be graded? |
| `shell.history` | read | no | Recent commands. |
| `shell.addRule` | write | yes | Personal always-allow / always-block rule. |

```jsonc
{ "command": "git status", "cwd": "reigan", "timeoutMs": 60000 }
```

`cwd` accepts a project name as well as a path. Output is capped at 100KB;
timeout defaults to 60s (max 600s) and kills the whole process tree.

**Classification runs on parsed segments, never the raw string.**
`git status && rd /s /q C:\` is refused *as a whole* — the line is split
(quote- and backtick-aware), each segment graded, highest tier wins, and one
blocked segment poisons everything. Patterns that span a pipe (`curl … | sh`)
are matched against the whole line first, because splitting destroys them.

Commands carrying a credential-shaped literal (`sk-`, `ghp_`, `AKIA`, JWTs,
PEM headers) are refused: running one would write the secret verbatim into
`shell_history`.

> **Cut:** interactive PTY sessions. `node-pty` cannot build on this machine
> (no MSVC toolchain), so `shell.sessionCreate` / `sessionWrite` /
> `sessionKill` / `listSessions` are **not registered** rather than stubbed. A
> tool the model can see and cannot use is worse than one that is absent.

## File & Folder Organizer

| id | risk | approval | summary |
| --- | --- | --- | --- |
| `files.planOrganize` | read | **no** | Work out what would happen. Moves nothing. |
| `files.executePlan` | **destructive** | yes | Carry out a plan by `planId`. |
| `files.undoRun` | write | yes | Reverse a run. |
| `files.findDuplicates` | read | no | Byte-identical files. Report only. |
| `files.listRules` / `files.upsertRule` | read / write | no / yes | Saved rules. |
| `files.listRuns` | read | no | Run history, with undo availability. |

The asymmetry is the safety model: planning is free, so *"what would you clean
up in Downloads?"* gets a complete answer with nothing moved; executing always
prompts.

```jsonc
// files.planOrganize
{
  "scopePath": "C:\\Users\\you\\Downloads",
  "recursive": false,
  "conditions": [
    { "kind": "mimeFamily", "values": ["installer"] },
    { "kind": "olderThan", "days": 30, "field": "modified" }
  ],
  "actions": [{ "kind": "trash" }],
  "collisionPolicy": "rename"
}
```

Destination tokens: `{yyyy} {MM} {dd} {name} {ext} {family} {counter}`.

**Guarantees.** The scope is guarded at plan time, so a plan against
`C:\Windows` cannot be built at all. Every op is re-guarded at execution,
because a plan may have waited in an approval queue while the filesystem
moved on. Deletes use `shell.trashItem`; there is **no `unlink` in the
module**. The journal stores a SHA-256 taken before each move, so undo
verifies by content and reports files whose bytes changed rather than
silently overwriting the newer version.

Plans live in memory for 30 minutes. A plan recovered after a restart would
describe a filesystem that has moved on.

**Trashed files are reported, not restored, on undo** — Windows has no
reliable scriptable Recycle Bin restore, and claiming otherwise would report
a success that did not happen.

## Snippet & Config Vault

| id | risk | approval | summary |
| --- | --- | --- | --- |
| `vault.search` | read | no | Search snippets. Secret bodies excluded from the index. |
| `vault.get` | read | no | One snippet. Secret bodies come back redacted. |
| `vault.create` / `vault.update` | write | yes | Save / edit. Versions kept (20 max). |
| `vault.listTemplates` | read | no | Shipped config templates. |
| `vault.renderTemplate` | read | no | Fill a template. |
| `vault.writeToFile` | write | yes | Write a snippet or rendered template to disk. |
| `vault.copyToClipboard` | write | yes | Put a snippet on the clipboard. |

**The privacy boundary.** A snippet marked `isSecret` is encrypted at rest,
excluded from the FTS index, and redacted before it reaches the model — but
still usable: `copyToClipboard` and `writeToFile` run entirely in main, so the
value reaches the user without entering the conversation. Each tool
description explains *why* the body is withheld, so the model treats the
redaction as intended rather than as an error to retry.

Excluding secret bodies from FTS is not incidental: an FTS5 table stores its
input verbatim, so indexing one would write the plaintext into a second
unencrypted table and undo the encryption.

Shipped templates: `.env` (Node/Vite), `.gitignore` (Node/Python/Windows),
`tsconfig.json`, ESLint + Prettier, GitHub Actions Node CI, docker-compose
(Postgres + Redis). An unsupplied required field stays a visible `{{TOKEN}}`
and is reported — a compose file that looks finished with a blank password is
worse than one that obviously is not.

## GitHub

**Not built.** Migration 7 creates `github_repos`, `github_issues`,
`github_commits` and `github_etags`, and the local half of the join is already
populated — the scanner records each project's `remote_url`. Device-flow auth,
sync, insights and the view remain.

---

## Adding a capability

1. Add an entry to a file in `src/main/capabilities/defs/`.
2. Register the array in `register.ts`.

That is the whole registration step. The IPC surface, the preload method and
the model's tool schema are all generated. `registration.test.ts` will fail if
the id collides, is malformed, mutates without an approval spec, carries an
unexplained `uiOnly`, or has a description too short to be usable.
