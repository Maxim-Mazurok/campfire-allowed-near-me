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

## Phase 1: Contract unification ✅ COMPLETE

Shared contracts live in `packages/shared/src/` (`contracts.ts`, `websocket.ts`, `distance.ts`). Both API and web import from there. No duplicate DTO definitions remain.

## Phase 2: API decomposition

### Remaining
- Split `LiveForestDataService` (~1800 lines) into focused pipeline modules.
- Keep `LiveForestDataService` as orchestration shell only.
- Add unit tests for each extracted module.

See [`/todo.md`](/todo.md) for the full task list.

## Phase 3: Web decomposition ✅ COMPLETE

`App.tsx` reduced from ~2300 to ~500 lines. Extracted components: `FilterPanel`, `ForestListPanel`, `MapView`, `WarningsDialog`, `SettingsDialog`, `AppHeader`, `LocationStatusPanels`. Hooks, selectors, and domain logic extracted into `apps/web/src/lib/`.

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

1. PR 1: API extraction pass 1 (snapshot + assemblers).
2. PR 2: API extraction pass 2 (matching + enrichment modules).
3. PR 3: Guardrails and docs updates.
