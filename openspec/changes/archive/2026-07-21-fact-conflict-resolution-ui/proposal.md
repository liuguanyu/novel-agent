# fact-conflict-resolution-ui

## Why

The backend can already suspend a summon/dialogue run when the reviewer raises `requiresHumanDecision` consistency issues: the graph's `awaitDecision` node calls `interrupt()`, and the runtime emits an `interrupt-raised` control event carrying the pending issues. The runtime's `resume` path and the graph fully handle every author decision (`approve` / `reject` / `correct` / `modify`). But the renderer's dialogue axis only subscribes to `onDialogueStream`, never `onControlEvent`, so `interrupt-raised` from the main summon flow is invisible. The author sees the dialogue turn end but is never shown the conflicts and has no way to adjudicate them — the human-in-the-loop is broken for reviewer-raised conflicts. Only the separate fact-extraction panel currently consumes `interrupt-raised`, and only for extraction conflicts.

## What Changes

- Surface `interrupt-raised` events for summon/dialogue runs in the renderer by consuming `onControlEvent` alongside the existing dialogue stream.
- Render an inline adjudication panel in the dialogue axis that shows each pending issue's severity, type, description, evidence and decision options.
- Let the author resolve a suspended run by sending `resume-run` with `approve`, `reject`, or `correct.optionId` (per-option), reusing the existing typed command and runtime path.
- Harden the Main-side `resume-run` boundary so a malformed/unknown `decision` is rejected with a stream error instead of crashing the graph's exhaustive switch.

## Non-Goals

- No `modify` editor UX (author-edited issue list) in this change; the command shape stays but the UI surfaces approve/reject/correct only.
- No changes to the fact-extraction conflict panel, which already works.
- No new dashboard resolve-action wiring for global-audit `resolve-*` options (deferred).
