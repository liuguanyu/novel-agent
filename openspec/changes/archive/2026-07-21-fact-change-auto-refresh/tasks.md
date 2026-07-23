## 1. Specification

- [x] 1.1 Add renderer-app-shell delta: Story Bible auto-refreshes on fact-changing events.
- [x] 1.2 Add quality-dashboard delta: completed audit marked stale on fact change.

## 2. Renderer

- [x] 2.1 Extend `useStoryBible` to refresh on `fact-extraction-completed` with a new fact version.
- [x] 2.2 Extend `useDashboard` to expose a `stale` flag set when facts change after a completed audit.
- [x] 2.3 Surface the stale hint in `DashboardDrawer` (prompt to re-run), cleared on re-run.

## 3. Validation

- [x] 3.1 Run node and web TypeScript checks.
- [x] 3.2 Run ESLint.
- [x] 3.3 Run OpenSpec strict validation.
- [x] 3.4 Run production build.
