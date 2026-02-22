# Campfire Allowed Near Me

TypeScript full-stack app that answers: **Where is the closest NSW state forest where a campfire is legal right now?**

## Disclaimer
This project was developed with **Codex using the GPT-5.3.-Codex model**.

## Features
- Scrapes Forestry Corporation NSW fire-ban page and linked area pages.
- Scrapes Forestry Corporation NSW forests directory (`/visiting/forests`) and parses all facility filters.
- Uses **Solid Fuel Fire Ban** status only for burn legality.
- Ignores Firewood collection status for campfire legality.
- Maps forests with OpenStreetMap + Leaflet.
- Sidebar filters:
  - Fire ban status (`All`, `Allowed`, `Not allowed`)
  - Tri-state facilities (`with`, `without`, `doesn't matter`)
- Matches Forestry fire-ban forests to directory forests with fuzzy name scoring for minor naming differences/typos.
- Uses browser geolocation and computes nearest legal spot.
- Shows matching forests as large red map pins and non-matching forests as smaller grey pins.
- Shows per-forest facility icon rows in the list for quick vertical scanning.
- Persists coordinates in local SQLite cache (`data/cache/coordinates.sqlite`).
- Falls back to stale in-memory data if live scraping is temporarily blocked.

## Quick Start (Users)
1. Install Node.js 25+.
2. Clone the repository.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Install Playwright browser runtime:
   ```bash
   npx playwright install chromium
   ```
5. Start the app:
   ```bash
   npm run dev
   ```
6. Open the URLs printed in the terminal.
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
- `GEOCODE_MAX_NEW_PER_REQUEST` (default `25`)
- `GEOCODE_DELAY_MS` (default `1200`)
- `COORDINATE_CACHE_DB` (default `data/cache/coordinates.sqlite`)
- `FORESTRY_SNAPSHOT_PATH` (optional path to persist processed snapshots)
- `FORESTRY_SKIP_SCRAPE=true` (cache-only mode; requires in-memory data or `FORESTRY_SNAPSHOT_PATH`)
- `FORESTRY_USE_FIXTURE=fixtures/mock-forests.json` (deterministic fixture mode)

## Caching Strategy
- Raw Forestry page cache: `os.tmpdir()/campfire-allowed-near-me/forestry-raw-pages.json` (shared across worktrees, 1-hour TTL by default).
- Processed snapshot cache: disabled by default; optional via `FORESTRY_SNAPSHOT_PATH`.
- Coordinate cache: `data/cache/coordinates.sqlite` (ignored in git).
- Raw page cache avoids re-scraping identical Forestry HTML right after restarts.
- Coordinate cache keeps geocoding stable across restarts and reduces API calls.

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
