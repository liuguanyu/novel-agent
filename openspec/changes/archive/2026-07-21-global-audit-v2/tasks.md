## 1. Specification

- [x] 1.1 Add OpenSpec deltas for map-reduce audit runtime.
- [x] 1.2 Add OpenSpec deltas for quality dashboard presentation.
- [x] 1.3 Add OpenSpec deltas for IPC command/control events.

## 2. Main Runtime

- [x] 2.1 Add shared IPC command and control-event DTOs for global audit.
- [x] 2.2 Implement read-only fact-view audit helper that produces issues and health score.
- [x] 2.3 Add OrchestrationRuntime global audit entrypoint with abort semantics.
- [x] 2.4 Wire IPC handler for the new command.

## 3. Renderer

- [x] 3.1 Add Dashboard hook that sends audit commands and consumes control events.
- [x] 3.2 Upgrade DashboardDrawer to show run/progress/result/failure and abort.
- [x] 3.3 Wire DashboardDrawer selection callback for chapter anchors where possible.

## 4. Validation

- [x] 4.1 Run node and web TypeScript checks.
- [x] 4.2 Run ESLint.
- [x] 4.3 Run OpenSpec strict validation.
- [x] 4.4 Run production build.
