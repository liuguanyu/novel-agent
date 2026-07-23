## 1. Specification

- [x] 1.1 Add renderer-app-shell delta: dialogue-axis surfaces summon `interrupt-raised` and adjudication.
- [x] 1.2 Add ipc-contract delta: Main validates `resume-run` decision before driving the graph.

## 2. Main

- [x] 2.1 Validate the incoming `resume-run` decision shape in the IPC handler (or runtime), emitting a stream-error on malformed/unknown decisions.

## 3. Renderer

- [x] 3.1 Extend `useDialogue` to consume `onControlEvent`, tracking pending conflicts per summon runId.
- [x] 3.2 Expose resolve/reject/approve actions that send `resume-run`.
- [x] 3.3 Render an adjudication panel in `DialogueAxis` for pending conflicts.
- [x] 3.4 Wire the panel through `App.tsx`.

## 4. Validation

- [x] 4.1 Run node and web TypeScript checks.
- [x] 4.2 Run ESLint.
- [x] 4.3 Run OpenSpec strict validation.
- [x] 4.4 Run production build.
