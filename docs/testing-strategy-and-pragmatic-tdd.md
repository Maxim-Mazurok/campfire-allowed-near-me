# Testing Strategy and Pragmatic TDD Plan

Last updated: 2026-02-25

## Testing Philosophy

Maintain a practical pyramid:
- **Many unit tests** for policy/parsing/selector logic.
- **Some integration tests** for route + service interactions.
- **Few E2E tests** for core user journeys.

Do not chase 100% coverage. Chase confidence in critical decisions and failure paths.

## Current Baseline

- Unit: strong, with extensive parser and service behavior checks.
- Integration: healthy route/progress/location-enrichment coverage.
- E2E: broad happy-path and warning/interaction coverage.

## Gaps to Address

1. Selector-level tests for web filtering/warnings once extracted.
2. Contract tests for shared DTO compatibility between API and web.
3. Performance regression tests (lightweight, threshold-based).
4. Connector contract tests for new data sources.
5. Deterministic tests for LLM-enriched paths with strict fallback behavior.

## Recommended Test Matrix

### Unit tests (highest volume)
- Forest legality policy decisions.
- Matching thresholds and tie-breakers.
- Source parsers (happy and malformed variants).
- Warning aggregation and severity logic.
- Web selectors for filtering/sorting/derived counts.

### Integration tests
- `/api/forests` with combinations of:
  - user location on/off,
  - toll settings,
  - cache hit/miss,
  - refresh modes.
- Source connector + normalization wiring.
- FCNSW boundary lookup + fallback geocoder/routing behavior.

### E2E tests (minimal but high value)
- Initial load + nearest recommendation.
- Filter interactions.
- Warning dialogs and source links.
- Refresh/progress UI states.

## Pragmatic TDD Workflow

For each feature/refactor:
1. Add or update one failing unit/integration test for intended behavior.
2. Implement smallest code to pass.
3. Run focused tests first, then wider suite.
4. Update docs if architecture/decision changed.

## Performance Testing Plan

Introduce two lightweight suites:

1. **API performance smoke**
   - Use fixture with larger synthetic forest set.
   - Assert endpoint completes under baseline threshold in CI environment.

2. **UI render smoke**
   - Measure render timing for list/map with large fixture.
   - Compare against baseline snapshot to detect regressions.

Use non-flaky thresholds and trend tracking, not strict micro-benchmarks.

## Test Data Strategy

- Keep deterministic fixtures in-repo.
- Add one "large fixture" profile for scale tests.
- Keep live external tests opt-in (FCNSW ArcGIS live checks and local Nominatim fallback checks).

## CI Guardrails

Required checks per PR:
- typecheck
- unit + integration
- selective e2e (or full e2e when touch surface warrants)

Nightly/periodic checks:
- full e2e
- live integration checks
- performance smoke profiles

## Definition of Done (Testing)

A change is complete when:
- tests that describe new behavior exist,
- legacy behavior remains covered,
- no flaky-only assertions introduced,
- docs explain any altered assumptions.
