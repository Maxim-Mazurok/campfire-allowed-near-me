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
- Falls back to stale snapshot if live scraping is temporarily blocked.

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
6. Open:
   - Web: [http://localhost:5173](http://localhost:5173)
   - API: [http://localhost:8787/api/forests](http://localhost:8787/api/forests)

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
- `npm run dev`: run API and web together.
- `npm run dev:api`: run backend only.
- `npm run dev:web`: run frontend only.
- `npm run warm:coordinates`: force refresh and populate coordinate cache.
- `npm run typecheck`: TypeScript checks.
- `npm test`: unit + integration + e2e.
- `npm run build`: backend + frontend production build.

## Environment Variables
- `PORT` (default `8787`)
- `FORESTRY_ENTRY_URL` (default Forestry Corporation solid-fuel-fire-ban URL)
- `FORESTRY_DIRECTORY_URL` (default Forestry Corporation forests directory URL)
- `SCRAPE_TTL_MS` (default `900000`)
- `GEOCODE_MAX_NEW_PER_REQUEST` (default `25`)
- `GEOCODE_DELAY_MS` (default `1200`)
- `COORDINATE_CACHE_DB` (default `data/cache/coordinates.sqlite`)
- `FORESTRY_SKIP_SCRAPE=true` (force cache-only mode)
- `FORESTRY_USE_FIXTURE=fixtures/mock-forests.json` (deterministic fixture mode)

## Caching Strategy
- Snapshot cache: `data/cache/forests-snapshot.json` (ignored in git).
- Coordinate cache: `data/cache/coordinates.sqlite` (ignored in git).
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
