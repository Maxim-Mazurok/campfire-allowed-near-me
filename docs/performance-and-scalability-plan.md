# Performance and Scalability Plan

Last updated: 2026-02-25

## Why this matters now

Current UX is acceptable for small data volumes but will degrade with more forests and data sources. Performance work should happen now in small slices, before expansion multiplies complexity.

## Observed bottleneck candidates

### Frontend
- Large monolithic component computes many derived datasets.
- Forest list renders all rows at once.
- Map renders all markers at once.
- Filter interactions trigger expensive recomputation paths.

### Backend
- End-to-end request can include scraping + FCNSW boundary lookup/fallback geocoding + route enrichment.
- Route metrics are potentially expensive for many forests.
- Some processing paths are serialized inside large orchestrator flow.

## Performance Objectives

1. Keep filter interactions responsive at larger forest counts.
2. Keep initial results quick using cached/stale-safe strategy.
3. Avoid route/location-enrichment fan-out bottlenecks.
4. Preserve transparent progress reporting.

## Frontend plan

### Completed ✅
- Memoized selector functions with stable inputs extracted from `App.tsx`.
- UI split into focused components (FilterPanel, ForestListPanel, MapView, etc.).
- List virtualization via `@tanstack/react-virtual` with threshold-based activation.
- Viewport-aware marker rendering with zoom-aware budgets and padded bounds culling.
- Memoized marker components with stable path option objects.
- Single selected-marker popup layer instead of per-marker popups.

### Remaining
- User-facing loading states by stage (data loaded, routes pending, etc.).
- Defer non-critical panels/dialog data until opened.

## Backend plan

### P0
- Keep first response fast by separating essential legality data from expensive enrichments where possible.
- Ensure progress callback reports step-level timing and counts.

### P1
- Add route enrichment budget controls per request.
- Add background completion mode for route metrics on large sets.
- Improve cache-key strategy observability (hit/miss logging for route and location-enrichment caches).

### P2
- Add source connector parallelism with bounded concurrency and per-source timeout budgets.
- Add stale-while-revalidate behavior per source signal.

## Metrics to add immediately

- `/api/forests` latency (p50/p95).
- FCNSW boundary match ratio and fallback geocode cache hit ratio.
- Route cache hit ratio.
- Count of forests without coordinates.
- Count of forests with unknown ban statuses.
- Frontend render timing for filter apply.

## Practical implementation order

Remaining performance work (frontend high-impact baseline is complete):

1. Backend route budget and async enrichment behavior.
2. Source connector parallelism.
3. Performance regression CI smoke tests.
4. Instrumentation (p50/p95 latency, cache hit ratios).

## Exit criteria

- Large fixture interactions remain responsive.
- API responses avoid long blocking paths on repeat requests.
- Performance regressions are detectable in CI smoke tests.
