# Technical + Business Brief

Last updated: 2026-02-25

## Product Goal

Help users quickly answer:

**“Where is the closest NSW forest where a campfire is legal right now?”**

This is a trust-sensitive decision, so the product must remain:
- correct enough for planning,
- transparent about uncertainty,
- fast enough for repeated checks.

## Current Positioning

Strengths:
- Strong practical scope and clear user value.
- Good baseline test coverage and reliability.
- Useful diagnostics/warnings model already present.

Current constraints:
- Single dominant source and parsing-heavy backend path.
- Growing UI complexity in one large component.
- Performance risk when data volume expands.

## Strategic Direction (Startup Pragmatism)

We optimize for **speed of iteration** and **low change risk**:
- Keep architecture simple.
- Add source connectors and canonical model once.
- Avoid broad rewrites.
- Deliver features in small slices with measurable outcomes.

## North-Star Outcomes (Next 3 Months)

1. Add at least one additional data source with minimal friction.
2. Keep core legal recommendation flow stable while expanding signals.
3. Reduce UI lag for larger datasets.
4. Preserve confidence in correctness through focused tests and diagnostics.

## Product Capabilities to Add

### Priority A: Multi-source intelligence
- FCNSW ArcGIS polygon-first forest geometry (preferred over generic point geocoding).
- NSW National Parks/camping pages and metadata.
- Optional Google reviews signal (e.g., recent closures/conditions mentions).
- Ability to show source evidence per forest.

### Priority B: Explainability
- For each recommendation, expose:
  - source inputs used,
  - policy decisions made,
  - uncertainty flags.

### Priority C: Performance
- Better load latency and interaction smoothness with many forests.

## KPI Suggestions (simple and practical)

- P95 API response time for `/api/forests`.
- Time-to-interactive for first meaningful forest list.
- Cache hit rates for coordinates and routes.
- Number of forests with unknown status fields.
- Regression rate in ban-status logic tests.

## Delivery Cadence Proposal

- Weekly: one structural improvement + one user-facing improvement.
- Every PR: must include test updates when behavior changes.
- Every 2 weeks: update architecture notes and roadmap status.

## Decision Rules

When choosing between options:
1. Pick approach that reduces future change cost.
2. Prefer deterministic logic first; LLM only as optional enrichment.
3. Preserve source-of-truth policy constraints (Forestry Solid Fuel Fire Ban for legality core).
4. Avoid speculative abstractions unless a second use case exists.

## AI-Agent Friendly Development Rules

- Always implement via smallest vertical slices.
- Include explicit "why" in docs for non-obvious decisions.
- Keep module APIs narrow and typed.
- Add tests for decision logic and failure modes.
- Update docs in same PR when architecture decisions change.
