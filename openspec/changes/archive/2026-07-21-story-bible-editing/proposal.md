# story-bible-editing

## Why

Authors can now confirm Story Bible facts, but cannot correct wrong inferred values. A human-in-the-loop fact base needs a restricted edit path so authors can fix names, attributes, timeline descriptions, relation phases, and plot hook states without touching SQLite directly.

## What Changes

- Add a typed `edit-story-bible-fact` command and completion/failure events.
- Add Main-side validated edit operations that create a new fact version.
- Add minimal Story Bible Drawer edit controls for common fact fields.
- Refresh Story Bible after successful edits.

## Non-Goals

- No entity merge/delete yet.
- No bulk editing.
- No free-form SQL or raw JSON editing.
