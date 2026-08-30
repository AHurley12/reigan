# Approval surfaces

**Date:** 2026-08-21
**Status:** approved; §1 and part of §3 implemented, §2 and §4–§7 pending

## Problem

Two problems, one of which hides the other.

**The visible one.** Asking REIGAN to draft an email produced "Not done — the
user denied permission for: Save a draft email to …" without an approval card
ever appearing. The mail and calendar tools call `withPermission`, which routed
to `agents/permissionGate.ts` and sent on `agent:permission-request`. Nothing
listened: the preload exposes only the `approvals` bridge, and `ApprovalDialog`
listens on `approval:request`. The send went nowhere, the promise sat for two
minutes, and the timeout resolved `false` — which the caller reported as the
user's denial.

Eight actions were affected: four in `emailTools.ts` (`draft_email`,
`reply_to_email`, `archive_email`, `set_email_read_status`), two in
`calendarTools.ts`, one each in `settingsTools.ts` and `systemTools.ts`. The
capability framework's own approvals were fine — only the LangChain agent tools
were left on the retired gate.

It stayed hidden through a whole migration because a timeout and a real denial
produced *the same string*, and because no test covered `permissionGate`,
`withPermission`, or `draft_email`.

**The structural one.** Every approval renders as a full-screen modal, wherever
it came from. An approval REIGAN asks for mid-conversation belongs in the
conversation, not in a dialog thrown over whatever tab happens to be open.

## Design

### §1 Retire the legacy gate

`withPermission` calls `requestApproval` from the capability framework.
`agents/permissionGate.ts` is deleted along with `AgentPermissionRequest`, the
`AGENT_PERMISSION_*` channel constants, and the orphaned `ipcMain.on` receiver
in `ipc/agent.ts`.

The agent tools are **not** migrated into full capabilities. That is a larger
refactor and re-pointing one function is enough to put every approval through a
single path, which is what the routing in §2 needs.

Agent-tool approvals carry the tool name as their `capabilityId`, `risk: 'write'`,
and `requestedBy: 'agent'`.

### §2 Route by origin

```ts
export type ApprovalSurface = 'chat' | 'modal' | 'queue'

function surfaceFor(requestedBy: InvocationSource, capabilityId: string): ApprovalSurface {
  if (requestedBy === 'job') return 'queue'
  if (requestedBy === 'agent' && !capabilityId.startsWith('devtools.')) return 'chat'
  return 'modal'
}
```

| Origin | Surface |
|---|---|
| AI asks, any non-devtools capability | inline card in chat |
| AI asks, `devtools.*` | modal (unchanged) |
| User clicks in any tab | modal (unchanged) |
| Scheduled job | Approvals tab + notification |

Computed once in `requestApproval`, persisted in a new `surface` column so a
card returns to the right surface after a reload. A pure function, so the whole
table is directly testable.

### §3 Timeout stops meaning denial

One timer currently both releases the caller and denies the request. These split:

- **Turn release (2 min).** The promise resolves; the row stays `pending` and
  the card stays on screen.
- **No auto-deny anywhere.** A row leaves `pending` only on an explicit click or
  via the 7-day TTL sweep in `expireStaleApprovals`.

`ApprovalOutcome` gains a non-approving status for this case. **Every consumer
must fail closed**: `registry.ts` currently tests for `denied` and `queued` and
falls through to execute, so a new status would run unapproved work. The check
inverts to "proceed only when approved".

**As implemented (interim).** A timeout now yields `expired` rather than
`denied`, and `registry.ts` fails closed on any non-approved outcome. The row is
marked `expired` rather than left `pending`, because a card that outlives its
caller cannot yet be acted on — approving it would resolve the row and run
nothing. Leaving the row `pending` is correct only once §4 exists to execute the
continuation, and lands with it.

This is what stops the silent-failure class recurring: no caller can report a
timeout as the user's decision.

### §4 Deferred execution

Approving after the turn released must still perform the action. `withPermission`
holds `action` as a closure, which cannot be serialised, so it lives in an
in-memory registry keyed by approval id. On late approval the closure runs and
the result is pushed into chat as a new assistant message.

**Known limitation:** closures do not survive a restart. On startup, pending
`chat` and `modal` rows from a previous session are expired with a visible
"expired when the app closed" state rather than offering a button that cannot
work. `queue` rows are unaffected — the scheduler re-dispatches those from
persisted `id` + `args`. Migrating the agent tools to real capabilities would
remove this limitation and is the natural follow-up.

### §5 Chat rendering

A new `approvalStore` holds approvals with `surface === 'chat'`. `ChatPanel`
merges them into the rendered message stream by `requestedAt` so a card sits in
conversation order, but they are **not** written into persisted chat history.
On resolution the card collapses in place to a compact `✓ Approved` / `✕ Denied`
record.

A new `ApprovalCard.tsx` is built from `var(--*)` tokens and `.ornate` only.
Each theme already restyles `.ornate`, so the card inherits all four themes and
any future one with no per-theme code. `ApprovalDialog` is refactored to reuse
it, so the card is defined once and rendered in three places.

### §6 Approvals tab

`AppModule` gains `'approvals'`. A nav item carries a pending-count badge,
reusing the badge pattern `NavBar.tsx` already uses for `useJobAlertStore`.
`ApprovalsView` shows **Pending** (actionable, any surface) above **History**
(resolved, from `listApprovalHistory`). Same `ApprovalCard`.

### §7 Dev unchanged

`ApprovalDialog` stays mounted in `AppShell` and filters to `surface === 'modal'`.
Dev-tab behaviour is exactly what it is today.

### §8 Testing

TDD throughout, starting from a regression test for the original bug: an
agent-sourced approval that times out must not report itself as the user's
denial, and must not execute. Then the `surfaceFor` table exhaustively; the
release-without-deny path; late approval running the continuation; restart
expiry; and `ApprovalCard` resolve wiring.

## Migration

One additive column (`surface` on `approvals`). No data rewritten.

## Scope

~15 files: 7 main including one migration and one deletion, 1 preload, 7 renderer
of which 4 are new.
