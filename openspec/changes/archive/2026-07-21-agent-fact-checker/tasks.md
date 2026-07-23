## 1. Specification

- [x] 1.1 orchestration-graph delta: fact-checker is a built node; summon-named agent drives routing.
- [x] 1.2 context-assembly delta: fact-checker assembly strategy.

## 2. Summon → agent → action routing

- [x] 2.1 Add an agent → action projection (core `graph-topology` or a small map) so `agent` selects the action.
- [x] 2.2 Update `OrchestrationRuntime.#initialState` to derive `currentAction` from the summoned agent, falling back to mode semantics.

## 3. Fact-checker node

- [x] 3.1 Add the fact-checker system prompt as a typed `PromptTemplate` constant (prompt registry module).
- [x] 3.2 Add the `fact-checker` assembly strategy to `AGENT_ASSEMBLY_STRATEGIES`.
- [x] 3.3 Implement `factCheckerNode` (assemble → reasoning model → parse/validate `ConsistencyIssue[]` → merge hard-check → route).
- [x] 3.4 Register `fact-checker` in `BUILT_NODES` and wire it into the compiled graph (edges + conditional routing to awaitDecision/END).

## 4. Validation

- [x] 4.1 Run node and web TypeScript checks.
- [x] 4.2 Run ESLint.
- [x] 4.3 Run OpenSpec strict validation.
- [x] 4.4 Run production build.
- [x] 4.5 Run `smoke:orchestration` (graph still drives writer/reviewer; fact-checker reachable).
