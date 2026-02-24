# Architecture Audit and Pragmatic Roadmap

Last updated: 2026-02-25

## Executive Summary

This project is already in a strong MVP state:
- Core user value is clear and implemented end-to-end.
- Type safety and tests are in place and currently green.
- Domain logic is thoughtful (ban status, closures, routing, diagnostics).

Main risk is **change friction**, not correctness:
- A few files are very large and centralize too much behavior.
- Contract types are duplicated between API and web.
- Performance will degrade as forests/data sources grow.

This document proposes a pragmatic, startup-appropriate target:
- Keep current stack.
- Refactor only high-leverage seams.
- Add extension points for new data sources (parks, camping, reviews, LLM).
- Improve observability and performance incrementally.

## Observed Baseline (Current State)

### Runtime and tests
- Typecheck passes.
- Unit tests pass (54 tests).
- Integration tests pass (12 tests, 1 live test skipped by default).
- E2E tests pass (13 tests).

### Structural hotspots
- `apps/api/src/services/live-forest-data-service.ts` remains large (~1800 lines) — decomposition pending.
- `apps/web/src/App.tsx` reduced from ~2300 to ~500 lines ✅.
- `packages/shared/src` populated with shared contracts ✅.

### Performance and UX signals
- Map renders viewport-culled markers with zoom-aware budgets ✅.
- Forest list uses threshold-based virtualization ✅.
- Heavy derived calculations extracted to selectors ✅.
- In dev/E2E, websocket reconnect noise appears (`EPIPE`/`ECONNRESET` through Vite proxy).

## Key Risks

### 1) Delivery risk (maintainability)
Large files with mixed concerns make features slower to implement and harder for AI agents to modify safely.

### 2) Performance risk (scale)
As forest count and source count increase, unbounded rendering and synchronous transformations in the main component will cause sluggish UX.

### 3) Product risk (data expansion)
Adding new sources without a source plugin model will create branching logic and regressions.

### 4) Trust and explainability risk
No explicit architecture decision record trail yet; contributors and AI agents need stable decision docs.

## Target Architecture (Pragmatic, not enterprise-heavy)

### Guiding principles
- Keep existing stack and public behavior.
- Prefer composable pure functions over class growth.
- Separate ingestion, normalization, policy, and presentation.
- Make extension points explicit for new sources.
- Keep changes small and reversible.

### Proposed API domain layers

1. **Source Connectors**
   - One connector per source (Forestry, RFS, NSW Parks, Google Reviews, etc.).
   - Responsibilities: fetch/scrape, parse raw payload into source-specific models.

2. **Canonical Normalization**
   - Convert source-specific models into canonical entities:
     - `ForestCanonicalRecord`
     - `ForestStatusSignals`
     - `ForestSourceEvidence`

3. **Policy Engine**
   - Encodes business rules for legality and recommendation.
   - Example: Solid Fuel Fire Ban + Total Fire Ban + closure impact.
   - Pure functions and deterministic outputs.

4. **Enrichment Pipeline**
   - FCNSW boundary lookup (preferred), fallback geocoding, routing, optional LLM enrichers.
   - Each enrichment step independent and cache-aware.

5. **Query Assembly**
   - Builds API response DTO from canonical graph + user query options.

### Proposed web app layers

1. **Data hooks layer**
   - Query hooks and websocket progress hooks in `src/lib/hooks`.
2. **Selector layer**
   - Pure, memoized selectors for filtering/sorting/warnings.
3. **Presentation components**
   - Map panel, filter panel, warning dialogs, forest list, status banners.
4. **State model**
   - Keep UI state local, but grouped by concern (route settings, filters, dialogs, progress).

## Completed Refactoring

The following high-leverage refactors are done:

- **Shared contracts**: `packages/shared/src/` contains `contracts.ts`, `websocket.ts`, `distance.ts`. Both API and web consume from here; no duplicate DTOs.
- **App.tsx decomposition**: Reduced from ~2300 lines to ~500 lines. Extracted: `FilterPanel`, `ForestListPanel`, `MapView`, `WarningsDialog`, `SettingsDialog`, `AppHeader`, `LocationStatusPanels`, plus hooks (`use-reconnecting-websocket`, `use-forest-progress`, `use-refresh-and-location`, `use-warning-dialog-data`) and domain/selector modules in `apps/web/src/lib/`.
- **List virtualization**: `ForestListPanel` uses `@tanstack/react-virtual` with threshold-based activation.
- **Map viewport-aware rendering**: Marker culling to padded viewport bounds, zoom-aware unmatched marker budgets, memoized marker components. Logic extracted to `apps/web/src/lib/map-marker-rendering.ts`.
- **Memoized selectors**: Filter/sort/warning derivations moved to dedicated modules with stable inputs.
- **Closure impact enricher**: Rules-based structured impact extraction with optional LLM enrichment layer (activates when Azure OpenAI credentials are provided).

## Remaining Refactoring

See [`/todo.md`](/todo.md) for the current task list. Key remaining items:

- `LiveForestDataService` decomposition (still ~1800 lines).
- Source connector abstraction for multi-source expansion.
- New data source connectors (NSW Parks, Google reviews).
- Canonical confidence scoring and explainability payload per forest.
- FCNSW ArcGIS polygon-first integration and fallback geocoder demotion.

## Recommended File/Module Direction

### API
- `apps/api/src/domain/connectors/*`
- `apps/api/src/domain/normalization/*`
- `apps/api/src/domain/policy/*`
- `apps/api/src/domain/enrichment/*`
- `apps/api/src/domain/assembly/*`
- Keep route/controller thin.

### Web
- `apps/web/src/features/filters/*`
- `apps/web/src/features/forests/*`
- `apps/web/src/features/progress/*`
- `apps/web/src/features/warnings/*`
- `apps/web/src/lib/selectors/*`
- `apps/web/src/lib/hooks/*`

## Non-goals (to stay pragmatic)

- No microservices.
- No event bus.
- No heavy DDD framework.
- No full enterprise observability stack yet.
- No rewrite.

## Acceptance Criteria for This Roadmap

- New data source can be added without modifying central orchestrator logic heavily.
- `App.tsx` and `LiveForestDataService` both reduced to manageable orchestration shells.
- Contract types live in one place.
- Performance remains responsive with significantly larger forest counts.
- Test pyramid remains healthy and meaningful.


