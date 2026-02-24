# Campfire Allowed Near Me

TypeScript app that answers: **Where is the closest NSW state forest where a campfire is legal right now?**

## Disclaimer
This project was developed with **Codex using the GPT-5.3-Codex model**.

## Features
- Scrapes Forestry Corporation NSW fire-ban page and linked area pages.
- Loads NSW RFS Total Fire Ban status data and fire weather area map data.
- Scrapes Forestry Corporation NSW forests directory (`/visiting/forests`) and parses all facility filters.
- Scrapes Forestry NSW closures/notices feed (`https://forestclosure.fcnsw.net/indexframe`) and matches notices to forests.
- Applies only closures/notices active right now (future and expired notices are ignored).
- Extracts structured closure impacts (camping, 2WD, 4WD) from notice prose using deterministic rules, with optional Azure OpenAI enrichment.
- Uses **Solid Fuel Fire Ban** and **Total Fire Ban** data in forest status, and excludes fully closed forests from nearest legal recommendations.
- Ignores Firewood collection status for campfire legality.
- UI built with **Mantine v8** component library and **@tabler/icons-react** icons.
- Resolves forest coordinates with Google Geocoding API as the primary source, falling back to OpenStreetMap Nominatim when Google is unavailable or returns implausible results.
- Supports optional local Nominatim instance (`NOMINATIM_BASE_URL`) for development; uses public Nominatim in CI/GHA.
- Maps forests with OpenStreetMap + Leaflet.
- Computes haversine (straight-line) distances client-side from the static snapshot.
- Sidebar filters:
   - Solid Fuel Fire Ban (`All`, `Not banned`, `Banned`, `Unknown`)
   - Total Fire Ban (`All`, `No ban`, `Banned`, `Unknown`)
  - Closures/notices status (`All`, `Open only`, `No full closures`, `Has notices`)
  - Closure notice tags (`road/trail`, `camping`, `event`, `operations/safety`)
  - Planning impact warnings (`camping`, `2WD/4WD access`)
  - Tri-state facilities (`with`, `without`, `doesn't matter`)
- Matches Forestry fire-ban forests to directory forests with fuzzy name scoring for minor naming differences/typos.
- Uses browser geolocation and computes nearest legal spot.
- Excludes forests marked fully closed from nearest legal campfire recommendations.
- Shows matching forests as large red map pins and non-matching forests as smaller grey pins.
- Shows per-forest facility icon rows in the list for quick vertical scanning.
- Shows orange warning state on facility icons when notice impacts conflict with listed facilities (for camping and 2WD/4WD access).
- Shows closure badges (`Closed`, `Partial`, `Notice`) next to fire-ban badges.
- Persists coordinates in local SQLite cache (`data/cache/coordinates.sqlite`).
- Falls back to stale in-memory data if live scraping is temporarily blocked.

## Quick Start (Users)
1. Install Node.js 25+.
2. Clone the repository.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the app:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:5173` in your browser.

The app loads forest data from the pre-generated `public/forests-snapshot.json` file.
To regenerate the snapshot with fresh data, set up a `.env` file (see `.env.example`)
with `GOOGLE_MAPS_API_KEY` and run:
```bash
npm run warm:coordinates
```

Optional: run local Nominatim (Docker) for geocoding fallback:
```bash
docker run -it --rm -p 8080:8080 -e PBF_URL=https://download.geofabrik.de/australia-oceania-latest.osm.pbf mediagis/nominatim:4.5
```
Then set `NOMINATIM_BASE_URL=http://localhost:8080` in `.env`.
First startup imports OSM data and can take significant time/disk.

`npm run dev` also attempts to auto-start a local `campfire-nominatim` Docker container (unless `NOMINATIM_AUTO_START=0`).

## Quick Start (Developers)
1. Install dependencies and browser runtime:
   ```bash
   npm install
   npx playwright install chromium
   ```
2. Run type checks:
   ```bash
   npm run typecheck
   ```
3. Run tests:
   ```bash
   npm test
   ```
4. Build production artifacts:
   ```bash
   npm run build
   ```

## Scripts
- `npm run dev`: start the Vite dev server (auto-starts local Nominatim if available).
- `npm run dev:web`: run frontend only (Vite auto-increments to next free port if needed).
- `npm run warm:coordinates`: force refresh and populate coordinate cache.
- `npm run cache:reset`: clear local geocoding/snapshot caches.
- `npm run typecheck`: TypeScript checks.
- `npm test`: unit + integration + e2e.
- `npm run test:integration:nominatim-live`: run live local Nominatim integration check (requires local Nominatim ready).
- `npm run build`: frontend production build.

## Environment Variables
- `WEB_PORT` (default `5173`, frontend dev port)
- `VITE_STRICT_PORT=1` (frontend must bind exactly to `WEB_PORT`; otherwise fail)
- `WEB_PREVIEW_PORT` (default `4173`)
- `FORESTRY_ENTRY_URL` (default Forestry Corporation solid-fuel-fire-ban URL)
- `FORESTRY_DIRECTORY_URL` (default Forestry Corporation forests directory URL)
- `FORESTRY_CLOSURES_URL` (default `https://forestclosure.fcnsw.net/indexframe`)
- `FORESTRY_MAX_CLOSURE_CONCURRENCY` (default `4`, concurrent closure detail fetches)
- `FORESTRY_RAW_CACHE_PATH` (default `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json`)
- `FORESTRY_RAW_CACHE_TTL_MS` (default `3600000`)
- `CLOSURE_LLM_ENABLED` (`true\|false`; default auto-enabled when Azure credentials are present)
- `AZURE_OPENAI_ENDPOINT` (required for AI enrichment)
- `AZURE_OPENAI_API_KEY` (required for AI enrichment)
- `CLOSURE_LLM_DEPLOYMENT` (preferred Azure deployment name; falls back to `AZURE_OPENAI_DEPLOYMENT_REASONER`)
- `CLOSURE_LLM_DEPLOYMENT_DEEP` (optional deep model deployment; also reads `AZURE_OPENAI_DEPLOYMENT_DEEP`)
- `CLOSURE_LLM_MODEL_PROFILE` (`balanced\|max_quality\|low_cost`)
- `CLOSURE_LLM_TIMEOUT_MS` (default `90000`)
- `CLOSURE_LLM_RATE_LIMIT_RETRIES` (default `2`)
- `CLOSURE_LLM_MIN_CALL_INTERVAL_MS` (default `1000`)
- `CLOSURE_LLM_MAX_NOTICES_PER_REFRESH` (default `12`, cost-control cap)
- `CLOSURE_LLM_CACHE_PATH` (default `os.tmpdir()/campfire-allowed-near-me/closure-llm-impacts.json`)
- `CLOSURE_LLM_CACHE_TTL_MS` (default `604800000`, 7 days)
- `SCRAPE_TTL_MS` (default `900000`, in-memory processed snapshot TTL)
- `GOOGLE_MAPS_API_KEY` (required for Google Geocoding)
- `GEOCODE_MAX_NEW_PER_REQUEST` (default `25`)
- `GEOCODE_DELAY_MS` (default `1200`)
- `GEOCODE_TIMEOUT_MS` (default `15000`)
- `GEOCODE_RETRY_ATTEMPTS` (default `3`)
- `GEOCODE_RETRY_BASE_DELAY_MS` (default `750`)
- `NOMINATIM_LOCAL_DELAY_MS` (default `200`, pacing between local Nominatim requests)
- `NOMINATIM_LOCAL_429_RETRIES` (default `4`, extra retries when local Nominatim returns HTTP 429)
- `NOMINATIM_LOCAL_429_RETRY_DELAY_MS` (default `1500`, delay between local 429 retries)
- `NOMINATIM_BASE_URL` (optional override, default `http://localhost:${NOMINATIM_PORT}` with public Nominatim fallback)
- `NOMINATIM_AUTO_START` (default `1`, auto-start local Docker Nominatim in dev script)
- `NOMINATIM_PORT` (default `8080`)
- `NOMINATIM_GUNICORN_WORKERS` (default `8`, passed to local Nominatim container)
- `NOMINATIM_DNS_SERVERS` (default `1.1.1.1,8.8.8.8`, comma-separated DNS list passed to Docker)
- `NOMINATIM_IMAGE` (default `mediagis/nominatim:4.5`)
- `NOMINATIM_PBF_URL` (default Australia Geofabrik extract URL)
- `COORDINATE_CACHE_DB` (default `data/cache/coordinates.sqlite`)
- `ROUTE_CACHE_DB` (default `data/cache/routes.sqlite`)
- `ROUTE_MAX_CONCURRENT_REQUESTS` (default `8`)
- `FORESTRY_SNAPSHOT_PATH` (optional path to persist processed snapshots)
- `FORESTRY_SKIP_SCRAPE=true` (cache-only mode; requires in-memory data or `FORESTRY_SNAPSHOT_PATH`)
- `FORESTRY_USE_FIXTURE=fixtures/mock-forests.json` (deterministic fixture mode)

## Caching Strategy
- Raw Forestry page cache: `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json` (shared across worktrees, 1-hour TTL by default).
- Closure LLM impact cache: `os.tmpdir()/campfire-allowed-near-me/closure-llm-impacts.json` (7-day TTL by default).
- Coordinate cache: `data/cache/coordinates.sqlite` (ignored in git).
- Raw page cache avoids re-scraping identical Forestry HTML right after restarts.
- Coordinate cache keeps geocoding stable across restarts and reduces API calls.
- If cached coordinates become stale/incorrect, run `npm run cache:reset` and regenerate the snapshot.

## Production Deployment

The app runs in production as a **zero-server static site** on Cloudflare Pages:

- **Live site**: [campfire-allowed-near-me.pages.dev](https://campfire-allowed-near-me.pages.dev)
- **Data pipeline**: A scheduled GitHub Actions workflow ([update-forest-data.yml](.github/workflows/update-forest-data.yml)) runs twice daily, scrapes all data sources, and commits a fresh `forests-snapshot.json` to the repo.
- **Frontend**: The SPA loads forest data from the static snapshot. Haversine (straight-line) distances are calculated client-side.
- **Driving distances**: An optional Cloudflare Worker (`workers/routes-proxy/`) proxies Google Routes API requests to compute driving distances while keeping the API key server-side.
- **Cost**: ~$3.65/year for proxy bandwidth. Everything else is free tier.

See [docs/production-deployment-plan.md](docs/production-deployment-plan.md) for the full architecture and implementation details.

### Deploying the Worker (optional)

```bash
cd workers/routes-proxy
npm install
npx -y wrangler secret put GOOGLE_MAPS_API_KEY
npx -y wrangler deploy
```

## CI
GitHub Actions workflow runs on push and pull request:
- Install dependencies
- Install Playwright Chromium
- Typecheck
- Test
- Build

Workflow file: `.github/workflows/ci.yml`.

## Project Documentation
- `docs/production-deployment-plan.md`: zero-server production architecture, phased deployment, and cost analysis.
- `docs/scraping-findings.md`: scraping strategy validation results across 6 iterations.
- `docs/architecture-audit-and-roadmap.md`: architecture audit, risks, and phased roadmap.
- `docs/technical-business-brief.md`: product/technical goals and pragmatic delivery direction.
- `docs/quality-and-simplification-plan.md`: DRY/YAGNI-focused refactor sequence.
- `docs/testing-strategy-and-pragmatic-tdd.md`: test pyramid, gap analysis, and TDD workflow.
- `docs/performance-and-scalability-plan.md`: performance bottlenecks and scaling plan.
- `docs/data-source-expansion-and-llm-plan.md`: multi-source and LLM enrichment architecture plan.
- `docs/ai-implementation-handoff.md`: implementation order and safety checklist for AI agents.

## Notes on Source Reliability
Forestry endpoints are Cloudflare-protected for non-browser HTTP clients. This app uses Playwright-rendered scraping and cache fallback to stay operational when direct fetches are blocked.
