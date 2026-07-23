# global-audit-v2

## Why

Story Bible facts can now be extracted, ingested, and viewed. The next product step is an all-book quality audit that turns the accumulated structured facts into a red/yellow-card dashboard, so authors can find global continuity risks without manually scanning chapters.

## What Changes

- Add a manually triggered global audit command.
- Run a read-only map/reduce audit over the latest Fact Store view.
- Emit strongly typed audit progress/completion/failure events over the control channel.
- Project audit output into a Quality Dashboard model with an explainable health score and issue list.
- Upgrade the bottom Dashboard drawer to run, abort, and display the latest audit result.

## Non-Goals

- No automatic fact writes during audit.
- No LLM-based prose reread in this increment; audit works from the structured Story Bible skeleton.
- No one-click repair implementation yet; issues expose anchors for later local-diff repair.
