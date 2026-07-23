# fact-change-auto-refresh

## Why

Facts change whenever a chapter is extracted, the whole book is backfilled, or an extraction conflict is resolved by accepting new facts. Today the Story Bible view only refreshes after explicit confirm/edit/delete/merge operations, so a freshly extracted fact never appears until the author manually reopens the drawer or triggers one of those actions — the view silently goes stale. Likewise, a completed quality audit keeps showing its old health score and issue list even after the underlying fact version has moved on, giving the author a false sense that the report still reflects the current Story Bible.

## What Changes

- Refresh the Story Bible view automatically when a fact-extraction/backfill run completes and actually produced a new fact version.
- Mark a completed quality audit as **stale** when the fact base changes (extraction completes with a new version, or a confirm/edit/delete/merge lands), and show a non-blocking hint prompting the author to re-run the audit.
- Do NOT auto-re-run the global audit: it is an expensive LLM map-reduce and stays author-triggered.

## Non-Goals

- No automatic re-run of the global audit (LLM cost); staleness is a hint only.
- No change to extraction/audit backend pipelines or IPC event shapes.
- No polling or timers; refresh/staleness is driven purely by existing control events.
