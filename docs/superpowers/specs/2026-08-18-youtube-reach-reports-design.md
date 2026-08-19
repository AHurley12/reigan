# YouTube reach-report ingest

**Status:** approved, not yet implemented
**Date:** 2026-08-18

## Why

`yt_daily_stats.impressions` and `.ctr` have never held a value. The sync
requested `impressions,impressionClickThroughRate` from the YouTube Analytics
API, which offers neither — `impressions` was renamed `adImpressions` and is an
ads metric, and `impressionClickThroughRate` does not exist. Google rejected the
request as an unknown identifier on every video of every sync. That call was
removed in `c9b51a9`.

The cost was not the wasted request. With impressions pinned at zero, the two
CTR-dependent audit findings — `revival_thumbnail` and `revival_content` — could
never clear their thresholds, so a channel with a real packaging problem produced
output identical to a channel with none. `c9b51a9` made that gap visible via a
`ctr_unavailable` finding. This design closes it.

Thumbnail impressions exist in exactly one place: the YouTube **Reporting** API's
bulk reach reports.

## Established facts

Verified against Google's documentation before designing:

| Fact | Consequence |
|---|---|
| `channel_reach_basic_a1` dimensions: `date`, `channel_id`, `video_id` | Maps 1:1 onto `yt_daily_stats(video_id, date)` |
| Its metrics: `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr` | Exactly the two columns that sit empty |
| Requires `yt-analytics.readonly` | **Already granted.** No re-consent, no consent-screen change |
| `googleapis` v144 ships `youtubereporting` v1 | No new dependency |
| Creating a job backfills 30 days; first new report within 48h | The job must treat "no reports yet" as success |
| Historical reports live 30 days, regular ones 60 | Gaps become permanent if ingest stops for two months |
| Reporting quota is separate from the 10,000 Data API units | Costs nothing against the sync budget |
| Replaced datasets arrive as a **new report id** | Dedupe by report id is sufficient and correct |

## Architecture

One new module, `src/main/youtube/reporting.ts`, is the only code that touches
`youtubereporting`. Network access stays in thin wrappers so the parts worth
testing are pure or DB-level, matching how `sync.ts` and `audit.ts` are tested
today.

```
youtube.ingestReach  (capability, risk: network, requiresGoogle)
   │
   ├─ ensureReportingJob()   jobs.list → create channel_reach_basic_a1 if absent
   ├─ listNewReports()       jobs.reports.list, minus ids in yt_reach_reports
   ├─ downloadReport()       GET downloadUrl via OAuth2Client.request()
   ├─ parseReachCsv()        PURE: csv text → {date, videoId, impressions, ctr}[]
   └─ ingestReachRows()      upsert yt_daily_stats, record the report id
```

`api.ts` gains `reportingCall(label, fn)` beside `analyticsCall`, so
`invalid_grant` keeps funnelling through `handleInvalidGrant` in one place —
the rule that file already enforces. Reporting calls are **not** passed through
`meteredCall`; they do not consume Data API units, and metering them would
refuse syncs that are actually affordable.

### Schema — migration 15 (`yt-reach-reports`)

```sql
CREATE TABLE yt_reach_reports (
  report_id     TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  window_start  TEXT NOT NULL,   -- YYYY-MM-DD
  window_end    TEXT NOT NULL,
  rows_ingested INTEGER NOT NULL DEFAULT 0,
  ingested_at   INTEGER NOT NULL
);
```

Dedupe is by `report_id`. When YouTube replaces a dataset it issues a new report
id for the same window, so the replacement is picked up as new work and its rows
overwrite the originals through the same upsert. No version tracking needed.

Rows older than 90 days are pruned on each run; the table is a ledger of what has
been consumed, not an archive.

### Ingest semantics

Reach rows upsert into `yt_daily_stats`, writing **only** `impressions` and
`ctr`. A `(video_id, date)` with reach data but no sync row is inserted with
zeros elsewhere: a day with impressions and no views is not noise, it is the
exact signal `revival_thumbnail` exists to catch. Rows whose `video_id` is absent
from `yt_videos` are skipped, so deleted and private videos do not accumulate
orphans.

## The two failures this design exists to prevent

### The sync would erase the data

`syncVideoDailyStats` upserts with `ON CONFLICT ... impressions =
excluded.impressions, ctr = excluded.ctr` and, since `c9b51a9`, writes literal
`0` into both. Every 05:00 sync would wipe what the 05:30 ingest wrote, and the
symptom — impressions that appear overnight and vanish by morning — would be
maddening to diagnose.

The sync's upsert must stop owning those two columns. A regression test pins it:
ingest reach data, run the sync's write path over the same dates, assert the
values survive.

### The 48-hour wait would disable the job

For the first two days there is nothing to download. If "no reports" returns
failure, the retry streak reaches 4 and the job disables itself with a confusing
error — exactly what happened to "Sync YouTube channel" on 2026-08-18.

So both "job created, waiting for the first report" and "no new reports" are
**success** results carrying an explanatory message. The job only fails when
something is actually wrong.

## Known unknowns, and how they are handled

Two details cannot be confirmed until real data arrives. Both are absorbed by
`parseReachCsv`, which is pure and therefore cheap to test in both directions:

- **Date format.** The CSV `date` dimension may be `YYYYMMDD` or `YYYY-MM-DD`.
  The parser accepts either and normalizes to `YYYY-MM-DD`, which
  `yt_daily_stats` uses.
- **CTR scale.** Google's metric definition contradicts itself: it calls
  `video_thumbnail_impressions_ctr` a "percentage" and then gives the formula
  "clicks divided by impressions", which yields a fraction. The parser normalizes
  to a fraction, which is what `audit.ts` multiplies by 100 for display.

## Prerequisite outside the code

`youtubereporting.googleapis.com` is a separate API and is almost certainly not
enabled in Google Cloud project `220819498258` — the same wall the Analytics API
presented on 2026-08-17. The first run will fail with Google's "has not been used
in project…" message, which includes a direct enablement link. That message is
surfaced verbatim rather than wrapped, because Google's version is more useful
than anything this app would write.

## Wiring

- `seed.ts`: new system job "Ingest YouTube reach reports", `daily_at 05:30`,
  `catch_up: run_once`, seeded **disabled** with the same reason string as the
  sync job — an enabled job with no Google account fails nightly until it
  disables itself.
- `audit.ts`: `ctr_unavailable` copy changes from "REIGAN does not yet ingest" to
  naming the job to enable. The condition already tests for real data, so the
  finding switches itself off when rows land and `revival_thumbnail` /
  `revival_content` begin firing with no further change.

## Testing

No googleapis mocking; network lives in wrappers thin enough to leave untested,
consistent with the rest of `src/main/youtube`.

- `parseReachCsv` — table-driven: both date formats, both CTR scales, quoted
  fields, empty report, header-only file, malformed row, unknown video id.
- Ingest — DB-level: rows land on the right `(video_id, date)`; re-ingesting a
  report id is a no-op; a reach row for an unsynced day is inserted; a row for a
  video absent from `yt_videos` is skipped.
- Regression — the sync's write path does not clobber ingested reach data.
- Audit integration — with reach data present, `revival_thumbnail` fires and
  `ctr_unavailable` is gone.

## Out of scope

- `content_owner_reach_*` reports (this is a single-channel app).
- Any other report type in the Reporting API surface.
- Backfilling further than the 30 days Google provides at job creation — that
  history does not exist to fetch.
