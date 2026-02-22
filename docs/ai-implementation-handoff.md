# AI Implementation Handoff Guide

Last updated: 2026-02-23

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
- `ForestListPanel` now uses threshold-based virtualization via `@tanstack/react-virtual` for larger result sets while preserving the existing rendering path for smaller lists.
- `MapView` now culls rendered markers to the current padded viewport bounds, reducing marker work during pan/zoom on larger datasets.
- `MapView` now applies zoom-aware unmatched marker budgets at lower zoom levels, prioritizing closest-to-center unmatched forests to reduce dense marker rendering load.
- Map marker budgeting and closest-selection logic is now extracted into `apps/web/src/lib/map-marker-rendering.ts` with unit coverage for zoom tiers and nearest-selection behavior.
- `MapView` now renders both matched and unmatched markers through a shared memoized marker component with stable path option objects to reduce marker subtree churn.
- `VisibleForestMarkers` now computes visible matched markers and rendered unmatched markers in one memoized pass to reduce per-update array churn.
- `VisibleForestMarkers` now deduplicates viewport event updates via a signature check, reducing redundant recomputation after move/zoom/resize events.
- `MapView` now derives mapped forests and matched/unmatched partitions in a single pass through source forests.
- `ForestListPanel` now isolates virtualization into `VirtualizedForestList`, so `useVirtualizer` only runs when list size crosses the virtualization threshold.
- `ForestListPanel` now skips clone/sort work when 0–1 forests are present.
- `MapView` now uses a single selected-marker popup layer rather than embedding popups on every marker, reducing dense-marker detail rendering overhead while preserving click-to-view details.
- Current high-impact map/list rendering phases are complete; next work can focus on optional scalability features (for example marker clustering) if real-world dataset size grows beyond current assumptions.

### Step 4: Performance iteration (completed)
- List virtualization and map rendering optimizations have been implemented while preserving UX.

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
