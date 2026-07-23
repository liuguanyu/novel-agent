# story-bible-merge-delete

## Why

Extraction inevitably produces wrong or duplicate facts: the same character split across two entities under different aliases, or an inferred attribute/timeline event/relation/plot hook that never should have been captured. Authors can already confirm and edit facts, but there is no way to remove a mis-extracted fact or fold a duplicate entity into its canonical twin without editing SQLite directly. A human-in-the-loop fact base needs restricted delete and merge paths so authors can govern entity identity and prune noise.

## What Changes

- Add typed `delete-story-bible-fact` and `merge-story-bible-entities` commands plus completion/failure control events.
- Add Main-side validated delete/merge operations that create a new fact version and keep relation foreign keys consistent.
- Add minimal Story Bible Drawer controls to delete facts and merge a duplicate entity into a target.
- Refresh Story Bible after successful delete/merge.

## Non-Goals

- No bulk delete or multi-entity merge in one command (merge is source → single target).
- No undo UI beyond the existing version history.
- No free-form SQL or raw JSON editing.
