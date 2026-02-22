# Performance and Scalability Plan

Last updated: 2026-02-22

## Why this matters now

Current UX is acceptable for small data volumes but will degrade with more forests and data sources. Performance work should happen now in small slices, before expansion multiplies complexity.

## Observed bottleneck candidates

### Frontend
- Large monolithic component computes many derived datasets.
- Forest list renders all rows at once.
- Map renders all markers at once.
- Filter interactions trigger expensive recomputation paths.

### Backend
- End-to-end request can include scraping + geocoding + route enrichment.
- Route metrics are potentially expensive for many forests.
- Some processing paths are serialized inside large orchestrator flow.

## Performance Objectives

1. Keep filter interactions responsive at larger forest counts.
2. Keep initial results quick using cached/stale-safe strategy.
3. Avoid route/geocode fan-out bottlenecks.
4. Preserve transparent progress reporting.

## Frontend plan

### P0
- Move heavy derivations into memoized selector functions with stable inputs.
- Split UI into focused components to reduce rerender scope.

### P1
- Add list virtualization for forest list.
- Add viewport-aware marker rendering or clustering strategy.
- Avoid rendering non-visible marker details until needed.

### P2
- Add user-facing loading states by stage (data loaded, routes pending, etc.).
- Defer non-critical panels/dialog data until opened.

## Backend plan

### P0
- Keep first response fast by separating essential legality data from expensive enrichments where possible.
- Ensure progress callback reports step-level timing and counts.

### P1
- Add route enrichment budget controls per request.
- Add background completion mode for route metrics on large sets.
- Improve cache-key strategy observability (hit/miss logging for route and geocode caches).

### P2
- Add source connector parallelism with bounded concurrency and per-source timeout budgets.
- Add stale-while-revalidate behavior per source signal.

## Metrics to add immediately

- `/api/forests` latency (p50/p95).
- Geocode cache hit ratio.
- Route cache hit ratio.
- Count of forests without coordinates.
- Count of forests with unknown ban statuses.
- Frontend render timing for filter apply.

## Practical implementation order

1. Instrumentation first.
2. Selector extraction.
3. List virtualization.
4. Marker rendering strategy.
5. Backend route budget and async enrichment behavior.

## Exit criteria

- Large fixture interactions remain responsive.
- API responses avoid long blocking paths on repeat requests.
- Performance regressions are detectable in CI smoke tests.
