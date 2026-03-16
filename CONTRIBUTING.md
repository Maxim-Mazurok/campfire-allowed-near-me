# Contributing

Thanks for your interest in contributing to Campfire Allowed Near Me! This guide covers everything you need to get the project running locally, understand the architecture, and submit changes.

## Prerequisites

- Node.js 25+
- Docker (optional, for local Nominatim geocoding)

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/Maxim-Mazurok/campfire-allowed-near-me.git
   cd campfire-allowed-near-me
   ```

2. Install dependencies and browser runtime:
   ```bash
   npm install
   npx -y playwright install chromium
   ```

3. Run the frontend:
   ```bash
   npm run dev:web
   ```

The app loads forest data from the pre-generated `web/public/forests-snapshot.json` file, so you can work on the frontend without any API keys or scraping setup.

### Full pipeline (data regeneration)

To regenerate the snapshot with fresh scraped data, copy `.env.example` to `.env` and fill in the required keys (see [Environment Variables](#environment-variables)), then run:

```bash
npm run generate:snapshot
```

Optional: run local Nominatim (Docker) for geocoding fallback:
```bash
docker run -it --rm -p 8080:8080 \
  -e PBF_URL=https://download.geofabrik.de/australia-oceania-latest.osm.pbf \
  mediagis/nominatim:4.5
```
Then set `NOMINATIM_BASE_URL=http://localhost:8080` in `.env`. First startup imports OSM data and can take significant time and disk space.

`npm run dev` also attempts to auto-start a local `campfire-nominatim` Docker container (unless `NOMINATIM_AUTO_START=0`).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (auto-starts local Nominatim if available) |
| `npm run dev:web` | Frontend only (Vite auto-increments to next free port if needed) |
| `npm run generate:snapshot` | Run the full pipeline and generate `forests-snapshot.json` |
| `npm run cache:reset` | Clear local geocoding/snapshot caches |
| `npm run typecheck` | TypeScript type checks across all sub-projects |
| `npm test` | Full suite: typecheck + unit + integration + e2e |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run test:e2e:headed` | E2E tests in headed browser mode |
| `npm run test:integration:nominatim-live` | Live local Nominatim integration check |
| `npm run build` | Frontend production build |

## Architecture Overview

The project has three main parts:

1. **Data pipeline** (`pipeline/`) — Scrapes Forestry Corporation NSW, RFS fire ban data, and closure notices. Geocodes forests using FCNSW ArcGIS geometry (with Google/Nominatim fallback). Produces `forests-snapshot.json`.

2. **Frontend** (`web/`) — Mantine v8 + Leaflet SPA that loads the static snapshot. Computes haversine distances client-side. Includes filters, map, and forest list.

3. **Routes proxy** (`workers/routes-proxy/`) — Optional Cloudflare Worker that proxies Google Routes API requests for driving distance estimates while keeping the API key server-side.

### Data flow

```
Forestry Corp NSW ─┐
RFS Fire Bans ─────┤  GitHub Actions    forests-snapshot.json    Cloudflare Pages
FCNSW Closures ────┼─→ (2x daily) ──→ committed to repo ──→ served as static asset
FCNSW ArcGIS ──────┘                                              ↓
                                                           Browser loads SPA
```

### Key data sources

- **Solid Fuel Fire Ban**: Forestry Corporation NSW fire-ban page — the source of truth for burn legality.
- **Total Fire Ban**: NSW RFS data.
- **Forest closures/notices**: FCNSW closures feed, matched to forests, with deterministic impact extraction (and optional Azure OpenAI enrichment).
- **Forest geometry**: FCNSW ArcGIS dedicated-state-forest polygons (preferred), Google Geocoding and Nominatim as fallback.

### Detailed documentation

| Document | Description |
|---|---|
| [docs/production-deployment-plan.md](docs/production-deployment-plan.md) | Zero-server production architecture, Cloudflare Pages deployment, cost analysis |
| [docs/snapshot-pipeline.md](docs/snapshot-pipeline.md) | Snapshot generation pipeline details |
| [docs/nsw-forest-integration-guide.md](docs/nsw-forest-integration-guide.md) | FCNSW ArcGIS integration and polygon-first lookup strategy |
| [docs/scraping-findings.md](docs/scraping-findings.md) | Scraping strategy validation across 6 iterations |
| [docs/architecture-audit-and-roadmap.md](docs/architecture-audit-and-roadmap.md) | Architecture audit, risks, and phased roadmap |
| [docs/technical-business-brief.md](docs/technical-business-brief.md) | Product/technical goals and delivery direction |
| [docs/testing-strategy-and-pragmatic-tdd.md](docs/testing-strategy-and-pragmatic-tdd.md) | Test pyramid, gap analysis, and TDD workflow |
| [docs/performance-and-scalability-plan.md](docs/performance-and-scalability-plan.md) | Performance bottlenecks and scaling plan |
| [docs/data-source-expansion-and-llm-plan.md](docs/data-source-expansion-and-llm-plan.md) | Multi-source and LLM enrichment architecture plan |
| [docs/ai-implementation-handoff.md](docs/ai-implementation-handoff.md) | Implementation order and safety checklist for AI agents |
| [docs/architecture/](docs/architecture/) | C4 architecture model (Structurizr DSL), ADRs, and diagrams |

## Tech Stack

- **Frontend**: TypeScript, Mantine v8, Leaflet, Vite
- **Pipeline**: TypeScript (tsx), Playwright (stealth scraping), SQLite (coordinate cache)
- **Hosting**: Cloudflare Pages (static site) + optional Cloudflare Worker (routes proxy)
- **CI/CD**: GitHub Actions — CI on push/PR, scheduled data pipeline 2x daily
- **Testing**: Vitest (unit + integration), Playwright (e2e)

## Environment Variables

Copy `.env.example` to `.env` to get started. Most variables have sensible defaults — you only need to set a few.

### Key variables (likely need configuring)

| Variable | Description |
|---|---|
| `GOOGLE_MAPS_API_KEY` | Google Maps API key — used for fallback geocoding and driving distance estimates via Google Routes |
| `NOMINATIM_BASE_URL` | Override for Nominatim geocoding URL (default auto-starts local Docker instance) |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint — required for AI-powered closure impact extraction |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `CLOSURE_LLM_ENABLED` | `true` \| `false` — auto-enabled when Azure credentials are present |

### All other variables

The defaults work well for local development. Override only if you have a specific reason.

<details>
<summary>Web</summary>

| Variable | Default | Description |
|---|---|---|
| `WEB_PORT` | `5173` | Frontend dev port |
| `VITE_STRICT_PORT` | — | If `1`, frontend must bind exactly to `WEB_PORT` |
| `WEB_PREVIEW_PORT` | `4173` | Preview server port |

</details>

<details>
<summary>Scraping and pipeline</summary>

| Variable | Default | Description |
|---|---|---|
| `FORESTRY_ENTRY_URL` | Forestry Corp solid-fuel-fire-ban URL | Entry point for fire ban scraping |
| `FORESTRY_DIRECTORY_URL` | Forestry Corp forests directory URL | Forest directory page |
| `FORESTRY_CLOSURES_URL` | `https://forestclosure.fcnsw.net/indexframe` | Closures feed |
| `FORESTRY_MAX_CLOSURE_CONCURRENCY` | `4` | Concurrent closure detail fetches |
| `FORESTRY_RAW_CACHE_PATH` | `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json` | Raw page cache location |
| `FORESTRY_RAW_CACHE_TTL_MS` | `3600000` (1 hour) | Raw page cache TTL |
| `SCRAPE_TTL_MS` | `900000` (15 min) | In-memory processed snapshot TTL |
| `FORESTRY_SNAPSHOT_PATH` | — | Path to persist processed snapshots |
| `FORESTRY_SKIP_SCRAPE` | — | If `true`, cache-only mode |
| `FORESTRY_USE_FIXTURE` | — | Path to fixture file for deterministic testing |

</details>

<details>
<summary>LLM enrichment</summary>

| Variable | Default | Description |
|---|---|---|
| `CLOSURE_LLM_DEPLOYMENT` | — | Preferred Azure deployment name |
| `CLOSURE_LLM_DEPLOYMENT_DEEP` | — | Optional deep model deployment |
| `CLOSURE_LLM_MODEL_PROFILE` | — | `balanced` \| `max_quality` \| `low_cost` |
| `CLOSURE_LLM_TIMEOUT_MS` | `90000` | LLM request timeout |
| `CLOSURE_LLM_RATE_LIMIT_RETRIES` | `2` | Rate limit retry count |
| `CLOSURE_LLM_MIN_CALL_INTERVAL_MS` | `1000` | Minimum interval between LLM calls |
| `CLOSURE_LLM_MAX_NOTICES_PER_REFRESH` | `12` | Cost-control cap per refresh |
| `CLOSURE_LLM_CACHE_PATH` | `os.tmpdir()/campfire-allowed-near-me/closure-llm-impacts.json` | LLM result cache |
| `CLOSURE_LLM_CACHE_TTL_MS` | `604800000` (7 days) | LLM result cache TTL |

</details>

<details>
<summary>Geocoding</summary>

| Variable | Default | Description |
|---|---|---|
| `GEOCODE_MAX_NEW_PER_REQUEST` | `25` | Max new geocode lookups per request |
| `GEOCODE_DELAY_MS` | `1200` | Delay between geocode requests |
| `GEOCODE_TIMEOUT_MS` | `15000` | Geocode request timeout |
| `GEOCODE_RETRY_ATTEMPTS` | `3` | Retry attempts for failed geocode |
| `GEOCODE_RETRY_BASE_DELAY_MS` | `750` | Base delay for geocode retries |
| `COORDINATE_CACHE_DB` | `data/cache/coordinates.sqlite` | Coordinate cache database path |

</details>

<details>
<summary>Nominatim (local geocoding)</summary>

| Variable | Default | Description |
|---|---|---|
| `NOMINATIM_AUTO_START` | `1` | Auto-start local Docker Nominatim in dev |
| `NOMINATIM_PORT` | `8080` | Local Nominatim port |
| `NOMINATIM_GUNICORN_WORKERS` | `8` | Gunicorn workers for local Nominatim |
| `NOMINATIM_DNS_SERVERS` | `1.1.1.1,8.8.8.8` | DNS servers for Docker |
| `NOMINATIM_IMAGE` | `mediagis/nominatim:4.5` | Docker image |
| `NOMINATIM_PBF_URL` | Australia Geofabrik extract | OSM data extract URL |
| `NOMINATIM_LOCAL_DELAY_MS` | `200` | Pacing between local Nominatim requests |
| `NOMINATIM_LOCAL_429_RETRIES` | `4` | Extra retries for local 429 responses |
| `NOMINATIM_LOCAL_429_RETRY_DELAY_MS` | `1500` | Delay between 429 retries |

</details>

<details>
<summary>Routes</summary>

| Variable | Default | Description |
|---|---|---|
| `ROUTE_CACHE_DB` | `data/cache/routes.sqlite` | Route cache database path |
| `ROUTE_MAX_CONCURRENT_REQUESTS` | `8` | Concurrent Google Routes requests |

</details>

## Caching Strategy

- **Raw Forestry page cache**: `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json` — avoids re-scraping identical HTML right after restarts (1-hour TTL).
- **Closure LLM impact cache**: `os.tmpdir()/campfire-allowed-near-me/closure-llm-impacts.json` — caches AI enrichment results (7-day TTL).
- **Coordinate cache**: `data/cache/coordinates.sqlite` — keeps geocoding stable across restarts, reduces API calls (git-ignored).
- Clear all caches: `npm run cache:reset`.

## Production Deployment

The app runs as a **zero-server static site** on Cloudflare Pages:

- A scheduled GitHub Actions workflow runs twice daily, scrapes all data sources, and commits a fresh `forests-snapshot.json`.
- The SPA loads from the static snapshot — no backend server needed.
- An optional Cloudflare Worker proxies Google Routes API for driving distance estimates.
- Total cost: ~$3.65/year for proxy bandwidth. Everything else is free tier.

See [docs/production-deployment-plan.md](docs/production-deployment-plan.md) for full details.

### Deploying the routes proxy worker (optional)

```bash
cd workers/routes-proxy
npm install
npx -y wrangler secret put GOOGLE_MAPS_API_KEY
npx -y wrangler deploy
```

## CI

GitHub Actions runs on every push and pull request:
- Install dependencies + Playwright Chromium
- Typecheck
- Unit + integration + e2e tests
- Production build

Workflow: `.github/workflows/ci.yml`.

## Source Reliability Notes

Forestry Corp endpoints are Cloudflare-protected for non-browser HTTP clients. The pipeline uses Playwright with stealth plugins and a residential proxy to handle this. Cache fallback keeps the app operational when direct fetches are temporarily blocked.

## How This Project Was Built

This project was built almost entirely with AI assistance:

1. **Initial implementation** — scaffolded and developed using **OpenAI Codex (GPT-5.3-Codex model)** for the core scraping pipeline, data model, and initial UI.
2. **Refactoring and polish** — extensive refactoring, bug fixing, architecture improvements, and UI polish done with **Claude Opus 4.6** via GitHub Copilot agent mode in VS Code.

See [AGENTS.md](AGENTS.md) for the full set of instructions, conventions, and guardrails that AI agents follow when working in this codebase.
