# Production Deployment Plan

> Goal: Ship the app to the public with **zero ongoing server cost**, minimal maintenance, and high reliability.

---

## Architecture Summary (Current)

| Layer | Current | Notes |
|---|---|---|
| Frontend | Vite React SPA | Dev mode proxies to local API |
| API | Express + WebSocket (single process) | Runs locally on port 8787 |
| Scraping (fire bans) | Playwright (headless Chromium) | `forestrycorporation.com.au` — behind Cloudflare |
| Scraping (closures) | Playwright (headless Chromium) | `forestclosure.fcnsw.net` — behind Cloudflare |
| Total Fire Ban data | Direct `fetch()` to RFS XML/GeoJSON | `rfs.nsw.gov.au` — public API, no auth |
| Geocoding | Local Nominatim Docker + Google Places fallback | SQLite cache |
| Driving routes | Google Routes API (`computeRoutes`) | SQLite cache, needs `GOOGLE_MAPS_API_KEY` |
| Data persistence | JSON snapshots on disk + SQLite caches | `data/cache/` directory |
| WebSockets | Two channels: refresh progress + load progress | For live UI feedback |

---

## Proposed Production Architecture

```
┌─────────────────────────────────────┐
│  GitHub Actions (scheduled, 2x/day) │
│                                     │
│  1. Scrape Forestry NSW (Playwright)│
│  2. Fetch RFS Total Fire Ban data   │
│  3. Geocode forests (public APIs)   │
│  4. Produce forests-snapshot.json   │
│  5. Commit to data branch / R2      │
└──────────┬──────────────────────────┘
           │
           ▼
┌──────────────────────────────┐
│   Static JSON snapshot       │
│   (GitHub Pages / R2 / CDN)  │
└──────────┬───────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌────────┐  ┌─────────────────────┐
│  SPA   │  │  Cloudflare Worker   │
│ (CF    │  │  /api/routes (proxy) │
│ Pages) │  │  Google Routes API   │
└────────┘  └─────────────────────┘
```

### Core Principles

1. **Static-first**: Forest data (bans, closures, geocodes, facilities) changes slowly — once or twice a day is plenty. Pre-compute everything into a single JSON snapshot.
2. **No long-running server**: The Express API is eliminated from production. The SPA loads the snapshot directly from a static URL.
3. **Thin API only for routing**: A single Cloudflare Worker proxies Google Routes API requests (to hide the API key), or we use haversine (straight-line) distance as the default and offer driving distance as an opt-in enhancement.
4. **Free tier everything**: GitHub Actions (free for public repos), Cloudflare Pages (free), Cloudflare Workers (100K requests/day free), Google Routes API ($200 free monthly credit).

---

## Phase 1: Validate Scraping in CI (Immediate)

### Goal
Determine if Playwright scraping works from GitHub Actions runners (datacenter IPs), or if we get blocked by Cloudflare.

### Action Items

1. **Create a GHA workflow `scrape-test.yml`** that:
   - Installs Playwright Chromium
   - Runs a test script that attempts to fetch all three source URLs:
     - `https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans` (main fire ban page)
     - `https://www.forestrycorporation.com.au/visiting/forests` (facilities directory)
     - `https://forestclosure.fcnsw.net` (closure notices)
   - Logs whether Cloudflare challenge was served (using existing `isCloudflareChallengeHtml`)
   - Also tests plain `fetch()` (no browser) to see if simple HTTP works
   - Also tests the RFS endpoints with plain `fetch()` (these should work — they are public XML/JSON APIs)
   - Uploads scraped HTML as artifacts for inspection
   - Runs on `workflow_dispatch` (manual trigger) so we can test at will

2. **Expected outcomes**:
   - **RFS endpoints**: Should work with plain `fetch()`. No Cloudflare. These are government data feeds.
   - **Forestry Corporation**: Likely needs Playwright (Cloudflare protected). May work from GitHub Actions datacenter IPs since Cloudflare's free/basic bot protection often allows headless browsers from clean IPs. If blocked, we need `playwright-extra` + stealth plugin.
   - **Forest closures (fcnsw.net)**: Same as above — Cloudflare protected, test with Playwright.

3. **Fallback plan if GHA is blocked**:
   - Try `playwright-extra` with `puppeteer-extra-plugin-stealth` (patches `navigator.webdriver` and other fingerprint signals)
   - If still blocked: Use a residential proxy service (e.g., Bright Data free trial, or a cheap provider) — cost would be negligible for 2 requests/day
   - Last resort: Switch to a self-hosted runner on a VPS (but this defeats the "free" goal)

### Why not plain HTTP?
The code already has `isCloudflareChallengeHtml` detection everywhere, indicating the Forestry sites use Cloudflare bot protection. The current Playwright-based scraper exists specifically for this reason. However, it is worth re-testing from GHA since:
- Cloudflare's challenge behavior varies by IP reputation
- GitHub Actions runners use well-known Microsoft/Azure IP ranges with generally good reputation
- The sites may have loosened their bot protection since the scraper was written

---

## Phase 2: Static Data Pipeline (GHA Scheduled Workflow)

### Goal
Replace the live-scraping Express API with a pre-computed JSON snapshot, rebuilt on a schedule.

### Workflow: `update-forest-data.yml`

```yaml
on:
  schedule:
    - cron: '0 6,18 * * *'  # Twice daily (6 AM, 6 PM UTC = ~4-5 PM, 4-5 AM AEST)
  workflow_dispatch:         # Manual trigger

jobs:
  update-snapshot:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - checkout
      - setup Node 25
      - npm ci
      - install Playwright Chromium
      - run: npx tsx scripts/generate-snapshot.ts
        env:
          GOOGLE_MAPS_API_KEY: ${{ secrets.GOOGLE_MAPS_API_KEY }}
      - commit & push snapshot to `data` branch (or upload to R2)
```

### New script: `scripts/generate-snapshot.ts`

This script reuses the existing `ForestryScraper`, `TotalFireBanService`, and `OSMGeocoder`, but:
- Outputs a `PersistedSnapshot` JSON file (same schema as existing snapshots)
- Uses public Nominatim for geocoding (no Docker needed) — rate-limited to 1 req/sec, but fine for a batch job that runs twice a day
- Skips driving route computation (that is user-specific and done client-side or via Worker)
- Includes all forest points with coordinates, ban statuses, facilities, closure data
- Saves to `data/forests-snapshot.json`

### Data flow

1. GHA runs `generate-snapshot.ts`
2. Script scrapes → parses → geocodes → assembles snapshot
3. Snapshot committed to a `gh-pages` or `data` branch, or uploaded to Cloudflare R2
4. SPA fetches snapshot at load time from a static URL

### Geocoding Strategy (No Docker)

Current setup uses a local Nominatim Docker container with an Australia OSM PBF extract. For production:

- **Primary**: Public Nominatim API (`nominatim.openstreetmap.org`) — free, 1 req/sec rate limit per the usage policy. Fine for batch geocoding in GHA (there are ~150-200 forests, once geocoded they are cached).
- **Cache persistence**: The SQLite geocode cache can be committed alongside the snapshot, or the snapshot can include pre-resolved coordinates (which it does — `latitude`/`longitude` fields on each `ForestPoint`).
- **Google Places fallback**: Use the existing Google Places geocoding as fallback (covered by the $200/month free credit).
- **Key insight**: Once all forests are geocoded, the coordinates are stable. New forests appear rarely. The cache file size is small (~100KB of SQLite). We can store the resolved coordinates directly in the snapshot JSON.

---

## Phase 3: Frontend Deployment (Cloudflare Pages)

### Why Cloudflare Pages over GitHub Pages?
- Both are free for static sites
- Cloudflare Pages integrates natively with Cloudflare Workers (for the routing API proxy)
- Better global CDN performance
- Custom domain support with free SSL
- However, GitHub Pages is perfectly fine too if you prefer staying in the GitHub ecosystem

### Build Changes

1. **Remove API proxy from Vite prod config**: The SPA will load data from a static JSON URL, not from `/api/forests`.

2. **New data loading layer**: Replace the current `fetchForests()` API call with a static fetch:
   ```typescript
   const SNAPSHOT_URL = import.meta.env.VITE_SNAPSHOT_URL
     ?? "https://data.campfire-allowed-near.me/forests-snapshot.json";
   
   const fetchSnapshot = async (): Promise<PersistedSnapshot> => {
     const response = await fetch(SNAPSHOT_URL);
     return response.json();
   };
   ```

3. **Remove WebSocket dependencies from production build**: WebSockets are only needed for the local dev experience (live refresh progress). In production, data is pre-computed and static.
   - Keep the WebSocket code but gate it behind an environment variable or dev-mode check:
   ```typescript
   const enableWebSockets = import.meta.env.DEV || import.meta.env.VITE_ENABLE_WS === "true";
   ```

4. **Remove the refresh button from production UI**: Data is refreshed by GHA, not by the user.
   - Alternatively: Keep it as a link to the GHA workflow status page for transparency.

### Distance Calculation

Since driving routes are user-specific (different origin for each user), we have two tiers:

#### Tier 1: Haversine (Default, Free, Instant)
- Calculate straight-line distance from user location to each forest using the existing `haversineDistanceKm()` utility
- This runs entirely client-side, no API needed
- Good enough for initial sorting ("nearest forests, roughly")
- Already implemented in the codebase

#### Tier 2: Driving Distance (Opt-in, via Cloudflare Worker)
- User clicks "Get driving distances" or it auto-loads after initial render
- SPA calls a Cloudflare Worker endpoint: `POST /api/routes`
- Worker proxies to Google Routes API `computeRoutes` with the user's origin and all forest destinations
- Worker hides the `GOOGLE_MAPS_API_KEY` as an environment secret
- Results are cached in Cloudflare KV (keyed by rounded lat/long + forest ID) to avoid redundant API calls
- **Cost**: Google Routes API gives $200/month free credit. Each `computeRoutes` call with `TRAFFIC_AWARE_OPTIMAL` is ~$0.015 (Pro tier). 150 forests per user = ~$2.25 per user load. That is ~88 free user loads per month, which is plenty for a pet project. If needed, use the Essentials tier ($0.005/request) by removing `TRAFFIC_AWARE_OPTIMAL` — then 150 forests = $0.75/user = ~266 free loads/month.
- **Alternative**: Use OSRM (Open Source Routing Machine) via the public demo instance at `router.project-osrm.org` — completely free, but may have rate limits and less accuracy than Google. Could serve as a fallback.

---

## Phase 4: Cloudflare Worker for Routes API Proxy

### Why a Worker?
- Hides `GOOGLE_MAPS_API_KEY` from client-side code
- Can add rate limiting / abuse protection
- Can cache results in Cloudflare KV (free: 1GB storage, 100K reads/day)
- 100K free requests/day is more than enough

### Worker Design

```
POST /api/routes
Body: {
  origin: { latitude, longitude },
  forestIds: string[],       // which forests to compute routes for
  avoidTolls: boolean
}
Response: {
  routes: Record<string, { distanceKm, durationMinutes }>,
  warnings: string[]
}
```

The Worker:
1. Receives user origin + forest IDs
2. Looks up forest coordinates from a preloaded snapshot (stored in KV or hard-coded from the latest build)
3. Checks KV cache for existing routes from a nearby origin (within ~5km, matching existing logic)
4. For cache misses, calls Google Routes API (`computeRoutes`) in batches
5. Caches results in KV
6. Returns aggregated response

### Implementation Notes

- Use `wrangler` for local development and deployment
- Store `GOOGLE_MAPS_API_KEY` as a Worker secret
- Optionally accept the full snapshot URL as a binding, so the Worker can fetch forest coordinates dynamically
- Or: Use Compute Route Matrix API for bulk lookups (up to 625 elements/request at Essentials tier) — more efficient than individual `computeRoutes` calls. This would compute all 150 forests in a single API call.

---

## Phase 5: Polish and Production Hardening

### SPA Adjustments

1. **Loading states**: Show haversine distances immediately, then progressively enhance with driving distances
2. **Offline fallback**: Cache the latest snapshot in `localStorage` or `IndexedDB` so the app works even if the CDN is down
3. **Snapshot freshness indicator**: Show "Data updated: X hours ago" based on `fetchedAt` from the snapshot
4. **Error handling**: If snapshot fetch fails, show cached data with a stale warning

### Data Quality

1. **Monitoring**: Add a GHA job that runs after the snapshot update and:
   - Validates the snapshot schema
   - Checks that the forest count hasn't dropped below a threshold (guards against scraping failures)
   - Alerts via GitHub Issues if something looks wrong
2. **Staleness guard**: If the scrape fails, don't overwrite the previous good snapshot

### Local Dev Experience

Keep the current Express + WebSocket setup for local development:
- `npm run dev` continues to spin up the API server with live scraping
- Production SPA is built with `VITE_SNAPSHOT_URL` pointing to the static data
- Dev SPA uses the API proxy as it does today
- No breaking changes to the dev workflow

---

## Cost Analysis

| Service | Free Tier | Our Usage | Cost |
|---|---|---|---|
| GitHub Actions | 2,000 min/month (free for public repos: unlimited) | ~30 min/month (2 runs/day × ~5 min × 30 days = ~300 min worst case) | **$0** |
| Cloudflare Pages | Unlimited bandwidth, unlimited sites | 1 site, low traffic | **$0** |
| Cloudflare Workers | 100K requests/day | A few hundred/day at most | **$0** |
| Cloudflare KV | 1GB storage, 100K reads/day | Tiny | **$0** |
| Google Routes API | $200/month free credit | ~$0.75-$2.25 per user load × maybe 50 users/month = $37-$112 | **$0** (covered by credit) |
| Google Places API | Part of $200/month credit | Negligible (forests are geocoded once) | **$0** |
| Public Nominatim | Free (rate limited) | ~200 lookups per snapshot rebuild (only for new forests) | **$0** |
| **Total** | | | **$0/month** |

---

## Implementation Order

### Milestone 1: Validate (1-2 hours)
- [ ] Create `scrape-test.yml` GHA workflow
- [ ] Run it and analyze results
- [ ] Determine if stealth plugin or proxies are needed

### Milestone 2: Data Pipeline (half day)
- [ ] Create `scripts/generate-snapshot.ts` (reuse existing services)
- [ ] Create `update-forest-data.yml` GHA workflow
- [ ] Test end-to-end: trigger workflow → snapshot committed
- [ ] Validate snapshot schema and content

### Milestone 3: Frontend Static Mode (half day)
- [ ] Add static snapshot fetch mode to the SPA
- [ ] Gate WebSocket code behind dev-mode check
- [ ] Add haversine-only distance as default
- [ ] Configure Cloudflare Pages deployment (or GitHub Pages)
- [ ] Test production build with static data

### Milestone 4: Routes API Worker (half day)
- [ ] Create Cloudflare Worker project (or Vercel serverless function)
- [ ] Implement Google Routes API proxy with KV caching
- [ ] Integrate with SPA (progressive enhancement: haversine → driving)
- [ ] Deploy and test

### Milestone 5: Polish (few hours)
- [ ] Snapshot validation and alerting in GHA
- [ ] Offline/stale data fallback in SPA
- [ ] Clean up production vs dev code paths
- [ ] Update README with deployment instructions
- [ ] Custom domain setup

---

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Data update frequency | 2x/day | Forest fire bans change seasonally, not hourly |
| Frontend hosting | Cloudflare Pages (or GitHub Pages) | Free, fast, no maintenance |
| Driving routes | Cloudflare Worker + Google Routes API | Need to hide API key; $200/month free credit is sufficient |
| Default distance | Haversine (client-side) | Free, instant, no API needed |
| Geocoding | Public Nominatim + Google Places fallback | No Docker needed; coordinates cached in snapshot |
| WebSockets | Dev-only | No real-time data in production (snapshot is static) |
| Database | None | JSON snapshot + KV cache is sufficient |
| Refresh button | Hidden in production (or link to GHA status) | Users can't trigger scraping on static hosting |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cloudflare blocks scraping from GHA | No data updates | Try stealth plugin; fall back to residential proxy; worst case: manual local scrape + commit |
| Forestry Corporation changes page structure | Parser breaks, no data | Schema validation in GHA alerts via GitHub issue; parsers are already robust with fuzzy matching |
| Google API cost exceeds $200/month | Small bill | Set billing alerts; use Essentials tier ($0.005/req); or switch to OSRM (free) |
| Public Nominatim rate limits | Slow geocoding | Coordinates are cached; only new forests need geocoding; can also use Google Places |
| GHA scheduled runs are delayed | Data slightly stale | Acceptable for fire ban data; manual dispatch as backup |
