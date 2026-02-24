# Data Source Expansion and LLM Enrichment Plan

Last updated: 2026-02-25

## Objective

Enable rapid addition of new data sources (parks, camping metadata, reviews, advisories) while preserving deterministic legality logic and user trust.

## Core rule

Legality decision source of truth remains:
- Forestry NSW Solid Fuel Fire Ban data (+ existing total fire ban and closure logic).

New sources should enrich context, confidence, and user guidance, not silently override core policy.

## Connector model

Define a source connector contract:

- `fetchSnapshot(context)`
- `parseRaw(raw)`
- `normalizeToCanonical(parsed)`
- `healthStatus()`

Each connector returns:
- data payload
- warnings/errors
- freshness metadata
- provenance identifiers

## Canonical data model additions

Add canonical records for extension:
- `ForestSourceEvidence[]`
- `ForestAdvisorySignal[]`
- `ForestAmenitySignal[]`
- `ForestSentimentSignal[]` (optional)

Each signal should carry:
- source
- timestamp window
- confidence
- extraction method (`RULES`, `LLM`, `MANUAL`)

## LLM usage policy

### Allowed use
- Extracting structured signals from unstructured text/images.
- Summarizing closure prose into user-friendly notes.

### Not allowed
- Replacing deterministic legality policy engine.
- Making final legality decision solely from LLM inference.

## LLM architecture pattern

1. Deterministic parser first.
2. Optional LLM enrichment second.
3. Strict schema validation for LLM output.
4. Fallback to deterministic output on timeout/error.
5. Cache LLM output with TTL and provenance.

## Candidate source roadmap

### Source wave 0 (geospatial foundation)
- FCNSW ArcGIS dedicated-state-forest boundary connector as the preferred geometry source.
- Persist FCNSW identifiers/evidence in canonical records and use fallback geocoders only when unresolved.

### Source wave 1 (high confidence)
- NSW National Parks pages (status/notices/camping pages).
- Structured campsite metadata where available.

### Source wave 2 (medium confidence)
- Google Places metadata + review recency indicators.

### Source wave 3 (experimental)
- Image and prose condition analysis for planning hints.

## Risks and mitigations

1. **Entity matching drift**
   - Mitigation: canonical forest identity resolver with confidence scores and diagnostics.

2. **Noisy/contradicting sources**
   - Mitigation: signal priority model and evidence display.

3. **LLM cost/latency**
   - Mitigation: capped volume, cache, timeout, and optional feature flag.

4. **Unclear traceability**
   - Mitigation: include source evidence list in API payload and warnings.

## Testing additions for new sources

- Connector parser unit tests.
- Normalization contract tests.
- Evidence/provenance integration tests.
- LLM schema validation and fallback tests.

## Delivery plan (incremental)

Phase 1:
- Introduce connector abstraction with current Forestry source migrated.

Phase 2:
- Add NSW parks connector and wire into canonical model.

Phase 3:
- Add optional reviews connector + evidence display.

Phase 4:
- Add limited LLM enrichment for prose only under explicit feature flag.
