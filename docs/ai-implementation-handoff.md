# AI Implementation Handoff Guide

Last updated: 2026-02-22

This guide is optimized for AI coding agents making iterative changes safely.

## Repository intent

Primary user value:
- Find closest NSW forest where campfires are legal now.

Hard policy constraints:
- Keep Forestry NSW `Solid Fuel Fire Ban` as legality source of truth.
- Do not use firewood collection status for legality logic.

## Current top priorities

1. Reduce architecture bottlenecks (`App.tsx`, `LiveForestDataService`).
2. Unify shared API/web types in `packages/shared`.
3. Improve performance for larger forest sets.
4. Prepare source connector architecture for expansion.

## Recommended first implementation sequence

### Step 1: Shared contracts extraction
- Move duplicate DTO types into `packages/shared/src/contracts.ts`.
- Update API and web imports.
- Ensure no behavior changes.

### Step 2: Service decomposition
- Extract pure helper modules from `LiveForestDataService`.
- Keep orchestration in existing class to minimize churn.

### Step 3: Web selector and component extraction
- Move filter/sort/warning derivation logic into selectors.
- Split rendering into feature components.

### Current implementation snapshot
- Shared API and websocket contracts are now consumed from `packages/shared/src` by both API and web.
- `App.tsx` has extracted dialog and domain helpers, plus dedicated `FilterPanel` and `ForestListPanel` components.
- Reconnecting websocket callback handling is stabilized with ref-based callback wiring.
- Map/list rendering path now includes memoized `MapView` and `ForestListPanel` plus a memoized `ForestListItem` row.
- `MapView` now uses `preferCanvas` and single-pass matched/unmatched marker partitioning to reduce marker overhead.
- Remaining high-impact decomposition target is map/list scaling behavior under larger forest sets.

### Step 4: Performance iteration
- Add list virtualization and marker rendering strategy.
- Keep UX unchanged.

### Step 5: Connector scaffolding
- Introduce `SourceConnector` interface.
- Adapt current Forestry path to use it.

## Change safety checklist for AI agents

Before coding:
- Identify affected behavior and tests.
- Confirm no conflict with policy constraints.

During coding:
- Keep PR scope focused.
- Prefer pure functions and explicit types.
- Avoid introducing broad abstractions unless used immediately.

After coding:
- Run `npm run typecheck`.
- Run relevant test suites first, then `npm test` when scope is broad.
- Update docs in `docs/` if architecture or behavior changed.

## Definition of done for each PR

- Behavior documented and test-covered.
- No duplicated contracts introduced.
- File/module boundaries improved or preserved.
- No accidental policy logic drift.

## Open technical questions to resolve early

1. Which fields define canonical forest identity across all future sources?
2. How should conflicting source signals be prioritized and surfaced?
3. What is acceptable latency budget for first meaningful response?
4. Which LLM enrichments are worth running synchronously vs asynchronously?
