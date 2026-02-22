# Quality and Simplification Plan

Last updated: 2026-02-22

## Goals

1. Reduce cognitive load of core modules.
2. Improve change safety and onboarding speed.
3. Keep behavior unchanged while refactoring.

## Current Friction Points

- Very large multi-responsibility files (`App.tsx`, `LiveForestDataService`).
- Duplicated domain contracts between API and web.
- High coupling of filtering, rendering, and diagnostics assembly in one UI component.

## Refactor Principles

- Behavior-preserving extraction first.
- Pure function extraction before class/interface churn.
- One concern per module.
- No speculative abstractions.

## Phase 1: Contract unification (DRY)

### Tasks
- Populate `packages/shared/src` with canonical API/domain DTO types.
- Update API and web imports to shared contracts.
- Remove duplicated local type definitions.

### Acceptance checks
- Typecheck passes.
- No duplicate DTO definitions remain.
- API response shape unchanged.

## Phase 2: API decomposition

### Tasks
- Split `LiveForestDataService` into explicit internal pipeline modules:
  - `snapshot-repository`
  - `facilities-matcher`
  - `closure-matcher`
  - `geocode-enricher`
  - `route-enricher`
  - `forest-response-assembler`
- Keep `LiveForestDataService` as orchestration shell only.

### Acceptance checks
- Existing tests green.
- New unit tests for each extracted module.
- `LiveForestDataService` reduced substantially in length and branching.

## Phase 3: Web decomposition

### Tasks
- Extract these from `App.tsx`:
  - query/progress websocket hooks
  - preference persistence hook
  - forest selectors (`matching`, `warnings`, `sorted lists`)
  - presentation components (filter panel, warnings dialog, forest list panel)
- Keep `App.tsx` as composition layer.

### Acceptance checks
- E2E behavior unchanged.
- Forest list/filter/warnings logic covered by unit tests for selectors.
- `App.tsx` no longer hosts major business logic.

## Phase 4: Code health guardrails

### Tasks
- Add lightweight architectural lint checks (script-based if needed):
  - no type duplication for shared DTOs,
  - max file length warning threshold,
  - prevent direct cross-layer imports.
- Add PR checklist section for docs/tests updates.

### Acceptance checks
- CI reports structural drift early.
- Contributors have clear constraints.

## Suggested Pull Request Strategy

1. PR 1: shared contracts only.
2. PR 2: API extraction pass 1 (snapshot + assemblers).
3. PR 3: API extraction pass 2 (matching + enrichment modules).
4. PR 4: web hook extraction.
5. PR 5: web selector and component extraction.
6. PR 6: guardrails and docs updates.

This keeps risk low and review quality high.
