# TODO

Remaining work, sequenced by logical dependency (not by priority or time estimates).

## API decomposition

- [ ] Split `LiveForestDataService` (1800+ lines) into focused pipeline modules: snapshot-repository, facilities-matcher, closure-matcher, geocode-enricher, route-enricher, forest-response-assembler
- [ ] Keep `LiveForestDataService` as a thin orchestration shell
- [ ] Add unit tests for each extracted module

## Source connector abstraction

- [ ] Define a source connector interface (`fetchSnapshot`, `parseRaw`, `normalizeToCanonical`, `healthStatus`)
- [ ] Migrate existing Forestry source into connector pattern
- [ ] Add canonical data model types (`ForestSourceEvidence`, `ForestAdvisorySignal`, `ForestAmenitySignal`)

## New data sources

- [ ] Add NSW National Parks connector (status/notices/camping pages)
- [ ] Add optional Google Places reviews connector (metadata + review recency indicators)
- [ ] Wire source evidence into API response payload for per-forest explainability

## LLM enrichment activation

- [ ] Provision Azure OpenAI credentials for closure notice enrichment (already built, needs credentials + feature flag)
- [ ] Add LLM schema validation and fallback tests

## Production deployment (remaining)

- [ ] Deploy and test Cloudflare Worker (routes-proxy) in production
- [ ] Add offline/stale data fallback in SPA (localStorage or IndexedDB)
- [ ] Clean up production vs dev code paths
- [ ] Update README with production deployment instructions
- [ ] Set up custom domain

## Code health

- [ ] Add architectural lint checks: max file length warning, shared DTO duplication guard
- [ ] Add performance regression smoke tests in CI (API endpoint threshold, UI render timing)
- [ ] Add contract tests for shared DTO compatibility between API and web

## Optional / future

- [ ] tRPC pilot for one new endpoint (evaluate DX vs current REST + shared contracts)
- [ ] Marker clustering for very large forest counts
- [ ] Backend route enrichment budget controls and async completion mode
- [ ] Source connector parallelism with bounded concurrency
