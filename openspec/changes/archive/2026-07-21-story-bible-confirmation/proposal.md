# story-bible-confirmation

## Why

Story Bible facts can be extracted, viewed, and audited, but authors still cannot promote inferred facts into confirmed facts from the UI. This leaves the fact base permanently AI-inferred and weakens future conflict checks.

## What Changes

- Add a restricted Story Bible confirmation command from Renderer to Main.
- Allow Main to mark entity, entity attribute, timeline event, relation phase, or plot hook facts as confirmed in a new fact version.
- Emit strong typed completion/failure control events for confirmation.
- Add confirmation controls to the Story Bible drawer and refresh the view after confirmation.

## Non-Goals

- No arbitrary manual editing of fact values yet.
- No delete/merge UI yet.
- No automatic conflict resolution; confirmed facts still must not be silently overwritten by later extraction.
