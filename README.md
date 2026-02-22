# Campfire Allowed Near Me

TypeScript full-stack app that answers: **Where is the closest NSW state forest where a campfire is legal right now?**

## Disclaimer
This project was developed with **Codex using the GPT-5.3.-Codex model**.

## Features
- Scrapes Forestry Corporation NSW fire-ban page and linked area pages.
- Loads NSW RFS Total Fire Ban status data and fire weather area map data.
- Scrapes Forestry Corporation NSW forests directory (`/visiting/forests`) and parses all facility filters.
- Uses both **Solid Fuel Fire Ban** and **Total Fire Ban** status for campfire legality.
- Ignores Firewood collection status for campfire legality.
- Resolves forest coordinates with Google Places first, then falls back to OpenStreetMap only when Google geocoding fails.
- Supports optional local Nominatim fallback (`NOMINATIM_BASE_URL`) for high-volume/local development geocoding.
- Maps forests with OpenStreetMap + Leaflet.
- Computes driving distance/time with Google Routes traffic for next Saturday at 10:00 AM (request-time calculation).
- Route settings let users choose `No tolls` (default) or `Allow toll roads`.
- Refreshes run as a background task with websocket progress updates (`/api/refresh/ws`).
- Sidebar filters:
  - Solid Fuel Fire Ban (`All`, `Not banned`, `Banned`, `Unknown`)
  - Total Fire Ban (`All`, `No ban`, `Banned`, `Unknown`)
  - Tri-state facilities (`with`, `without`, `doesn't matter`)
- Matches Forestry fire-ban forests to directory forests with fuzzy name scoring for minor naming differences/typos.
- Uses browser geolocation and computes nearest legal spot.
- Shows matching forests as large red map pins and non-matching forests as smaller grey pins.
- Shows per-forest facility icon rows in the list for quick vertical scanning.
- Persists coordinates in local SQLite cache (`data/cache/coordinates.sqlite`).
- Persists route metrics in local SQLite cache (`data/cache/routes.sqlite`) and reuses cache for user locations within a 5km radius.
- Falls back to stale in-memory data if live scraping is temporarily blocked.

## Quick Start (Users)
1. Install Node.js 25+.
2. Clone the repository.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create local environment file:
   ```bash
   cp .env.example .env.local
   ```
   Then set `GOOGLE_MAPS_API_KEY` in `.env.local`.

Optional: run local Nominatim (Docker) and point fallback geocoding at it:
```bash
docker run -it --rm -p 8080:8080 -e PBF_URL=https://download.geofabrik.de/australia-oceania-latest.osm.pbf mediagis/nominatim:4.5
```
Then set `NOMINATIM_BASE_URL=http://localhost:8080` in `.env.local`.
First startup imports OSM data and can take significant time/disk.

`npm run dev` also attempts to auto-start a local `campfire-nominatim` Docker container (unless `NOMINATIM_AUTO_START=0`).
5. Install Playwright browser runtime:
   ```bash
   npx playwright install chromium
   ```
6. Start the app:
   ```bash
   npm run dev
   ```
7. Open the URLs printed in the terminal.
   - Default first picks are Web `http://localhost:5173` and API `http://localhost:8787`.
   - If those ports are busy, the next available ports are selected automatically.

Optional: warm up local coordinate cache once:
```bash
npm run warm:coordinates
```

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
- `npm run dev`: find free ports, then run API and web together.
- `npm run dev:api`: run backend only (auto-increments to next free port if needed).
- `npm run dev:web`: run frontend only (Vite auto-increments to next free port if needed).
- `npm run warm:coordinates`: force refresh and populate coordinate cache.
- `npm run cache:reset`: clear local geocoding/route/snapshot caches.
- `npm run typecheck`: TypeScript checks.
- `npm test`: unit + integration + e2e.
- `npm run build`: backend + frontend production build.

## Environment Variables
- `API_PORT_START` (default `8787`, used by `npm run dev`)
- `WEB_PORT_START` (default `5173`, used by `npm run dev`)
- `PORT` (default `8787`, API server port when running `npm run dev:api`)
- `STRICT_PORT=1` (disable API auto-increment and fail immediately if `PORT` is busy)
- `VITE_API_PROXY_TARGET` (default `http://localhost:8787`, proxy target for `npm run dev:web`)
- `WEB_PORT` (default `5173`, frontend dev port for `npm run dev:web`)
- `VITE_STRICT_PORT=1` (frontend must bind exactly to `WEB_PORT`; otherwise fail)
- `WEB_PREVIEW_PORT` (default `4173`)
- `FORESTRY_ENTRY_URL` (default Forestry Corporation solid-fuel-fire-ban URL)
- `FORESTRY_DIRECTORY_URL` (default Forestry Corporation forests directory URL)
- `FORESTRY_RAW_CACHE_PATH` (default `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json`)
- `FORESTRY_RAW_CACHE_TTL_MS` (default `3600000`)
- `SCRAPE_TTL_MS` (default `900000`, in-memory processed snapshot TTL)
- `GOOGLE_MAPS_API_KEY` (required for Google Places geocoding and Google Routes driving metrics)
- `GEOCODE_MAX_NEW_PER_REQUEST` (default `25`)
- `GEOCODE_DELAY_MS` (default `1200`)
- `GEOCODE_TIMEOUT_MS` (default `15000`)
- `GEOCODE_RETRY_ATTEMPTS` (default `3`)
- `GEOCODE_RETRY_BASE_DELAY_MS` (default `750`)
- `NOMINATIM_BASE_URL` (optional, default public Nominatim endpoint)
- `NOMINATIM_AUTO_START` (default `1`, auto-start local Docker Nominatim in dev script)
- `NOMINATIM_PORT` (default `8080`)
- `NOMINATIM_DNS_SERVERS` (default `1.1.1.1,8.8.8.8`, comma-separated DNS list passed to Docker)
- `NOMINATIM_IMAGE` (default `mediagis/nominatim:4.5`)
- `NOMINATIM_PBF_URL` (default NSW Geofabrik extract URL)
- `COORDINATE_CACHE_DB` (default `data/cache/coordinates.sqlite`)
- `ROUTE_CACHE_DB` (default `data/cache/routes.sqlite`)
- `ROUTE_MAX_CONCURRENT_REQUESTS` (default `8`)
- `FORESTRY_SNAPSHOT_PATH` (optional path to persist processed snapshots)
- `FORESTRY_SKIP_SCRAPE=true` (cache-only mode; requires in-memory data or `FORESTRY_SNAPSHOT_PATH`)
- `FORESTRY_USE_FIXTURE=fixtures/mock-forests.json` (deterministic fixture mode)

## Caching Strategy
- Raw Forestry page cache: `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json` (shared across worktrees, 1-hour TTL by default).
- Processed snapshot cache: disabled by default; optional via `FORESTRY_SNAPSHOT_PATH`.
- Coordinate cache: `data/cache/coordinates.sqlite` (ignored in git).
- Route cache: `data/cache/routes.sqlite` (ignored in git, no TTL; reused for user locations within 5km).
- Raw page cache avoids re-scraping identical Forestry HTML right after restarts.
- Coordinate cache keeps geocoding stable across restarts and reduces API calls.
- Route cache prevents re-fetching hundreds of route calculations when the user location only changes slightly.
- If cached coordinates become stale/incorrect, run `npm run cache:reset` and then refresh from source.

## CI
GitHub Actions workflow runs on push and pull request:
- Install dependencies
- Install Playwright Chromium
- Typecheck
- Test
- Build

Workflow file: `.github/workflows/ci.yml`.

## Notes on Source Reliability
Forestry endpoints are Cloudflare-protected for non-browser HTTP clients. This app uses Playwright-rendered scraping and cache fallback to stay operational when direct fetches are blocked.
