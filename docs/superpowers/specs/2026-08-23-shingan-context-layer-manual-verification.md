# Context Layer — Manual Verification Checklist

The one surface in this feature with no automated coverage is the **Settings → Context** tab. Agents cannot drive a GUI, so this was deliberately never run rather than falsely reported as verified. Everything else on the branch is covered by 441 passing tests and a clean build.

Run this once before trusting the feature. Takes about five minutes.

## Setup

```
npm run dev
```

Open Settings with `Ctrl+,` and click the **Context** tab (Brain icon, between Personality and Japanese).

## 1. Empty state

Expect: *"Nothing learned yet. Facts appear here as you talk to Shingan and as your task data accumulates."*

No empty headings, no stray section scaffolding.

## 2. Add a fact by hand

Type something true about yourself into the "Add what Shingan should know" box and submit.

- It should appear immediately, grouped, with a **yours** badge.
- Re-submit the *same* text: it must **update in place**, not create a second row.

## 3. Learning toggle

Toggle **Keep learning** off (reads "Paused") and on (reads "Active"). Reopen the tab and confirm it persisted.

## 4. Distillation actually learns

With learning Active, send **four substantive** chat messages about your duties, projects, or habits. Short replies like "thanks" deliberately do not count toward the four.

Reopen the Context tab. At least one fact should appear under *Duties & roles*, *Goals & projects*, or *Patterns*.

## 5. Edit is durable

Click a fact's text, change it, press Enter.

- It gains the **yours** badge.
- It survives a tab reload.
- It should survive further chat turns — user-authored facts outrank anything distillation produces.

## 6. Delete is durable — the important one

This is the behaviour a whole-branch review found broken and fixed; it is worth confirming by hand.

1. Remove a **distilled** fact (trash icon). It moves to a muted **Removed** section.
2. Send four more substantive chat messages on the *same subject* as the removed fact.
3. Reopen the tab.

**The removed fact must NOT come back.** If it reappears in an active group, the fix regressed.

## 7. Restore preserves provenance

Click **Restore** on a removed fact.

- It returns to its original group.
- A restored **stat**-derived fact must **keep** its original source and confidence — it should *not* show the **yours** badge. (Restoring no longer promotes to user-authored; if it did, that fact's numbers could never update again.)

## 8. Clear everything means everything

Click **Clear everything** and confirm the two-step dialog.

- Facts and the Removed list both empty.
- Ask Shingan something and check its reply does not open by reciting your overdue task counts or cold projects. Those live in a separate stats table that Clear now also wipes.

Note: stats are *derived*, not learned, so reopening the Context tab recomputes them from your real task data. That is correct — clearing removes what it inferred, not your actual tasks.

## 9. Errors are visible, not silent

Force a failure (e.g. edit a fact in one window after clearing all facts in another).

Expect an **error toast**. The fact list must not silently blank or go stale.

## 10. Accessibility

Tab through the fact rows with the keyboard only. A screen reader or the browser's accessibility inspector should announce **"Save correction"**, **"Cancel edit"**, **"Remove fact"**, and **"Restore fact"** on the icon-only buttons.

---

## Known gaps, deliberately not built

- **No recurring stats refresh.** The spec asked for a jobs-scheduler entry; stats currently recompute at app launch and whenever you open the Context tab. A long-running session otherwise recites as-of-launch numbers.
- **`supersedes` is not implemented.** The unique `(kind, key)` index covers a fact being updated under the same key; only a model-initiated *key rename* is unsupported.
- **Fact rows show body and source only** — not confidence or last-seen date, which the spec's UI sketch mentioned.
