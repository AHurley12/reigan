# Capabilities

Every operation REIGAN can perform is declared once, in `src/main/capabilities/defs/`,
and registered in the capability registry. One declaration produces all three surfaces:

| Surface | How it reaches the capability |
| --- | --- |
| UI (renderer) | `window.reigan.capabilities.invoke(id, args)` → generic `capability:invoke` IPC channel |
| Assistant | A LangChain tool generated from the declaration by `capabilities/agentTools.ts` |
| Scheduler | `invokeCapability(id, args, { invokedBy: 'job' })` from `jobs/scheduler.ts` |

Before the registry, each feature was written three times — an IPC handler, a
hand-written preload method, and a separate tool — against three hand-maintained
lists. `ipc/tasks.ts` and the old `agents/tools/taskTools.ts` are the fossil record
of that: same five operations, twice, sharing only the query layer.

---

## Declaring a capability

```ts
{
  id: 'youtube.listVideos',        // dotted camelCase, unique app-wide
  title: 'List videos',            // shown in the UI and approval cards
  description: '…',                // handed to the model verbatim as the tool description
  risk: 'network',
  schema: z.object({ … }),         // validated at dispatch; becomes the tool schema
  handler: (args, ctx) => …,
}
```

Registration **throws** — at boot, loudly — on any of:

- a duplicate `id` (this is the id-collision check; there is no silent shadowing)
- an `id` that is not dotted camelCase
- `risk: 'write' | 'destructive'` with no `approval` spec
- `uiOnly: true` with no `uiOnlyReason`

## Risk tiers

Risk is declared on the capability and enforced at dispatch. It is not re-decided
per call site — that was the previous design's flaw, where forgetting to wrap a
new tool in `withPermission()` produced an ungated write with no type error.

| Tier | Meaning | Approval | Scheduler behaviour |
| --- | --- | --- | --- |
| `read` | Reads local state | never | runs normally |
| `network` | Reaches an external service | never | **deferred, not failed, when offline**; retries in ~5 min |
| `write` | Mutates the user's data, locally or remotely | required | queues for approval when unattended |
| `destructive` | Irreversible or bulk-destructive | required, worded more strongly | queues for approval when unattended |

### When approval is asked for

Approval is required for `write` and `destructive` — but **only when something
other than the user's own click initiated the call**. A UI invocation *is* the
user acting; prompting them to approve the button they just pressed is noise, and
it trains the reflex to approve without reading, which is exactly what breaks the
assistant case.

| `invokedBy` | Behaviour on a write/destructive capability |
| --- | --- |
| `ui` | Runs. The click is the approval. |
| `agent` | Live prompt with a before/after diff. Auto-denies after 2 minutes. |
| `job` | **Parks.** Persisted as pending, notification raised, run recorded as `awaiting_approval`. Executes when approved. |

The `job` row is the one that matters: a 3am YouTube metadata update must not be
silently auto-denied by a user who was asleep, and must not run unreviewed either.

## `uiOnly` — capabilities the model cannot see

`uiOnly: true` excludes a capability from the generated tool schema entirely. It
is enforced in two independent places:

1. `agentTools.ts` builds from `listModelVisibleCapabilities()`, which filters them out.
2. `invokeCapability` refuses a `uiOnly` id from any non-`ui` source, so even a
   leaked tool name cannot reach the handler.

`uiOnlyReason` is mandatory so this list stays auditable — an unexplained
exclusion is indistinguishable from an accident.

**Currently `uiOnly`:** none yet. Phase 7 adds `usage.getSessions` (raw window
titles, which must never enter model context) while `usage.getSummary`
(aggregates only) stays visible.

---

## Registered capabilities

### `jobs.*` — the scheduler's control surface

| id | Risk | Notes |
| --- | --- | --- |
| `jobs.list` | read | Includes human-readable schedule and relative next-run time |
| `jobs.history` | read | Recent runs with errors — the debugging surface |
| `jobs.upsert` | write | Validates the schedule and the target capability at save time |
| `jobs.enable` | write | Clears auto-disabled state and reschedules |
| `jobs.disable` | write | Keeps history |
| `jobs.runNow` | write | Outside the schedule; does not affect the next scheduled run |
| `jobs.delete` | destructive | Refuses to delete `system` jobs — disable those instead |

`jobs.upsert` rejects a `uiOnly` target: such a job could only ever fail, since
dispatch refuses `uiOnly` under `invokedBy: 'job'`.

### `tasks.*`

| id | Risk | Notes |
| --- | --- | --- |
| `tasks.list` | read | |
| `tasks.create` | write | |
| `tasks.update` | write | Diff reads current values from the DB at prompt time |
| `tasks.complete` | write | |
| `tasks.delete` | destructive | |

### `files.*`

| id | Risk | Notes |
| --- | --- | --- |
| `files.reindex` | read | Local disk only. Scheduled as the "Rebuild file index" system job |

---

## Not yet migrated

These still exist as hand-written IPC handlers and/or LangChain tools and have
**not** been moved into the registry. New work must not extend them.

`get_time`, `get_system_info`, `open_app`, `search_files`, `list_directory`,
`read_file`, `get_settings`, `update_setting`, `get_performance_snapshot`, and
the Google-gated calendar/email tools.

`ipc/tasks.ts` also remains, so the existing Tasks UI keeps working unchanged
while `tasks.*` capabilities serve the assistant. Both call `db/queries.ts`, so
there is no divergence in behaviour — only in plumbing.

---

## Error contract

`invokeCapability` never throws at its callers. It returns:

```ts
{ ok: true, result }
{ ok: false, error, errorCode, awaitingApprovalId? }
```

`errorCode` is one of `not_found`, `invalid_args`, `denied`, `offline`,
`not_connected`, `cancelled`, `handler_failed`, `awaiting_approval`.

The agent tool wrapper returns the error **as a string rather than throwing**, so
a failure lets the model read what went wrong and tell the user, instead of
aborting the turn.
