# agent-fact-checker

## Why

The orchestration graph declares nine expert nodes in `graph-topology.ts` (writer, reviewer, fact-checker, editor, style-editor, architect, character-generator, worldbuilding, scene-generator) and a full `ACTION_ROUTING` table, but only `writer` and `reviewer` are actually built (`BUILT_NODES = {writer, reviewer}`). Two things keep every other declared agent unreachable:

1. **The summon path cannot select a non-default agent.** `OrchestrationRuntime.#initialState` derives `currentAction` purely from `mode` (`diagnose → review`, `mutate → write`), ignoring the `agent` field that the unified `SummonCommand` already carries. So even though `ACTION_ROUTING` maps `fact-check → fact-checker`, no summon can ever produce `currentAction: 'fact-check'`.
2. **There is no fact-checker node.** The supervisor safely converges to `END` for any action outside `BUILT_NODES`.

This change opens the "summon → agent → action → node" path and lands the first new expert node — `fact-checker` — as the reference pattern for the remaining roster (I9 sub-phases B–E). Fact-checker is the lowest-risk first node: it produces the same `ConsistencyIssue[]` contract as reviewer, so it reuses the existing parse/validate, await-decision, and routing infrastructure without new output plumbing.

The fact-checker is positioned distinctly from the reviewer: reviewer runs **inside the write-review-revise loop** and checks narrative continuity of a freshly written draft; fact-checker is an **author-summoned, diagnose-only** pass over **existing content** that verifies factual/logical/world consistency against the Story Bible fact base.

## What Changes

- Add an agent → action projection so a summon that names `agent: 'fact-checker'` (or any routable agent) sets the matching `currentAction`, instead of only `mode` deciding it. Keep the existing mode semantics as the fallback when the agent has no dedicated action.
- Build the `fact-checker` graph node: assemble context under a fact-checker strategy, call the reasoning-tier model, parse/validate its output into `ConsistencyIssue[]` (reusing the reviewer's schema path), merge the deterministic fact hard-check, and route to `awaitDecision`/`END` like reviewer.
- Register `fact-checker` in `BUILT_NODES`, wire it into the compiled graph with its edges and conditional routing.
- Add a `fact-checker` assembly strategy (facts + entities + timeline heavy; it is a consistency pass).
- Add the fact-checker system prompt as a code-level template conforming to the existing `PromptTemplate` contract (external YAML runtime is deferred to sub-phase B).

## Non-Goals

- No YAML prompt-loading runtime yet (sub-phase B); the fact-checker prompt lives as a typed constant for now, same as writer/reviewer.
- No mutate/diff behavior for fact-checker; it is diagnose-only.
- No new IPC message shapes; the summon already carries `agent`, and fact-checker emits the existing dialogue/consistency events.
- No other roster nodes (scene-generator, editor, style-editor, architect, character-generator, worldbuilding, plagiarism-checker) — those are later sub-phases.

## Impact

- Depends on: orchestration-runtime (I3), story-bible-extraction (I4).
- Specs: `orchestration-graph` (fact-checker becomes a built node + summon-driven routing), `context-assembly` (fact-checker strategy).
- Code: `src/main/orchestration/graph.ts`, `src/main/orchestration/runtime.ts`, `src/main/orchestration/context-assembler.ts`, plus a new prompt-registry module under `src/main/orchestration/`.
