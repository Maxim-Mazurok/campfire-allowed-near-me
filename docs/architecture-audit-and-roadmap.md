# Architecture Audit and Pragmatic Roadmap

Last updated: 2026-02-22

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
- `apps/web/src/App.tsx` is very large (2306 lines).
- `apps/api/src/services/live-forest-data-service.ts` is very large (1768 lines).
- `tests/unit/live-forest-data-service.test.ts` is very large (1280 lines).
- `packages/shared/src` is empty while API and web define near-duplicate contract types.

### Performance and UX signals
- Map renders all matching and non-matching forests as live markers.
- Forest list renders all matching forests in one list (no windowing).
- Heavy derived calculations happen in `App.tsx`.
- In dev/E2E, websocket reconnect noise appears (`EPIPE`/`ECONNRESET` through Vite proxy).
- Runtime warning in browser console indicates React 19 compatibility concern in dependency stack (`element.ref` deprecation warning).

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
   - Geocoding, routing, optional LLM enrichers.
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

## Prioritized Refactoring Backlog

### P0 (start immediately, highest leverage)
1. Extract shared API contract types into `packages/shared/src` and consume from both API and web.
2. Split `LiveForestDataService` into pipeline modules:
   - snapshot loading/validation
   - source fetch/merge
   - facilities matching
   - closure matching
   - geocoding and routing enrichment
3. Split `App.tsx` into feature components + selectors modules.
4. Introduce a source connector interface for future data providers.

### P1 (near-term, performance + iteration speed)
1. Implement list windowing/virtualization for forest list.
2. Render only viewport-relevant markers or clustering at lower zoom levels.
3. Move expensive filter/sort/warning derivations into selectors with stable inputs.
4. Add endpoint-level timing metrics and cache hit ratios (basic telemetry logs).

### P2 (expansion readiness)
1. Add NSW parks connector and schema mapping.
2. Add optional reviews connector (Google Places reviews metadata only).
3. Add LLM extraction adapter behind strict budget and fallback rules.
4. Add canonical confidence scoring and explainability payload per forest.

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

## Suggested 6-Week Execution Sequence

Week 1:
- Shared contracts package + initial extraction.
- Architecture decision docs established.

Week 2:
- `LiveForestDataService` decomposition (no behavior changes).

Week 3:
- `App.tsx` decomposition + selectors.

Week 4:
- Performance pass (virtualization + marker strategy).

Week 5:
- Source connector abstraction + first new connector spike.

Week 6:
- Hardening: tests, docs, benchmarks, cleanup.
