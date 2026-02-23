# Production Deployment Plan

> Goal: Ship the app to the public with **zero ongoing server cost**, minimal maintenance, and high reliability.

---

## Architecture Summary (Current)

| Layer | Current | Notes |
|---|---|---|
| Frontend | Vite React SPA | Dev mode proxies to local API |
| API | Express + WebSocket (single process) | Runs locally on port 8787 |
| Scraping (fire bans) | Playwright (headless Chromium) | `forestrycorporation.com.au` — Cloudflare JS challenge |
| Scraping (forests dir) | Playwright (headless Chromium) | `forestrycorporation.com.au` — Cloudflare JS challenge |
| Scraping (closures) | Playwright (headless Chromium) | `forestclosure.fcnsw.net` — AWS API Gateway IP block |
| Total Fire Ban data | Direct `fetch()` to RFS XML/GeoJSON | `rfs.nsw.gov.au` — public, no auth |
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
│  1. Scrape Forestry NSW (Playwright │
│     + stealth + Decodo AU proxy)    │
│  2. Scrape closures (proxy fetch)   │
│  3. Fetch RFS Total Fire Ban data   │
│  4. Geocode forests (public APIs)   │
│  5. Produce forests-snapshot.json   │
│  6. Commit to data branch / R2      │
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

## Phase 1: Validate Scraping in CI ✅ COMPLETE

> Validated 2026-02-24 across 6 iterations of `scripts/scrape-test.ts`.
> Full findings: [docs/scraping-findings.md](scraping-findings.md)

### Result

All 5 data sources are scrapeable from GitHub Actions. Three different methods are needed:

| Target | Method | Why |
|---|---|---|
| forestrycorporation.com.au (2 pages) | Playwright + stealth + Decodo AU residential proxy (headed mode via xvfb) | Cloudflare Turnstile JS challenge requires both a real browser and a residential IP |
| forestclosure.fcnsw.net | `fetch()` through Decodo AU residential proxy (`undici.ProxyAgent`) | AWS API Gateway blocks datacenter IPs; no browser needed |
| rfs.nsw.gov.au (2 endpoints) | Plain `fetch()` | No bot protection |

### Key Findings

- **Plain `fetch()` from GHA**: blocked by Cloudflare (403) and AWS API Gateway (403 `{"message":"Forbidden"}`).
- **Playwright headless + stealth from GHA**: still blocked by Cloudflare (detects headless mode).
- **Playwright headed + stealth from GHA (no proxy)**: fire-bans page passed ~2/3 of the time, forests-directory never passed.
- **Residential proxy + `fetch()` (no browser)**: solved fcnsw.net, but Cloudflare still blocked (requires JS execution).
- **Residential proxy + Playwright headed + stealth**: all targets pass consistently.
- **Shared browser context**: critical for same-domain targets — reusing the context from fire-bans (easier challenge) lets forests-directory skip the challenge entirely.

### Proxy Service Chosen: Decodo (formerly Smartproxy)

- **Endpoint**: `au.decodo.com:30000` (Australian residential IPs)
- **Cost**: $3.50/GB Pay-As-You-Go, traffic valid for 12 months
- **Per-run bandwidth**: ~1.55 MB (3 proxy targets)
- **Annual cost**: ~$3.65/year at 2x/day
- **GitHub Secrets**: `DECODO_PROXY_USERNAME`, `DECODO_PROXY_PASSWORD`

### Artifacts

- Workflow: `.github/workflows/scrape-test.yml` (manual trigger)
- Script: `scripts/scrape-test.ts` (3 methods: `direct-fetch`, `proxy-fetch`, `proxy-browser`)
- Dependencies: `playwright-extra`, `puppeteer-extra-plugin-stealth`

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
      - install Playwright Chromium (npx playwright install --with-deps chromium)
      - run: xvfb-run --auto-servernum -- npx tsx scripts/generate-snapshot.ts
        env:
          GOOGLE_MAPS_API_KEY: ${{ secrets.GOOGLE_MAPS_API_KEY }}
          PROXY_USERNAME: ${{ secrets.DECODO_PROXY_USERNAME }}
          PROXY_PASSWORD: ${{ secrets.DECODO_PROXY_PASSWORD }}
      - commit & push snapshot to `data` branch (or upload to R2)
```

### New script: `scripts/generate-snapshot.ts`

This script reuses the existing `ForestryScraper`, `TotalFireBanService`, and `OSMGeocoder`, but:
- Outputs a `PersistedSnapshot` JSON file (same schema as existing snapshots)
- Uses public Nominatim for geocoding (no Docker needed) — rate-limited to 1 req/sec, but fine for a batch job that runs twice a day
- Skips driving route computation (that is user-specific and done client-side or via Worker)
- Includes all forest points with coordinates, ban statuses, facilities, closure data
- Saves to `data/forests-snapshot.json`

**Scraping approach** (validated in Phase 1):
- Forestry Corp pages: `playwright-extra` + stealth plugin + Decodo AU residential proxy + headed mode (xvfb). Shared `BrowserContext` for same-domain pages.
- Forest closures: `fetch()` through `undici.ProxyAgent` with Decodo proxy.
- RFS endpoints: Plain `fetch()` (no proxy needed).

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
| Decodo residential proxy | Pay-As-You-Go $3.50/GB, 12-month expiry | ~1.55 MB/run × 2/day × 365 = ~1.13 GB/year | **~$3.65/year** |
| Cloudflare Pages | Unlimited bandwidth, unlimited sites | 1 site, low traffic | **$0** |
| Cloudflare Workers | 100K requests/day | A few hundred/day at most | **$0** |
| Cloudflare KV | 1GB storage, 100K reads/day | Tiny | **$0** |
| Google Routes API | $200/month free credit | ~$0.75-$2.25 per user load × maybe 50 users/month = $37-$112 | **$0** (covered by credit) |
| Google Places API | Part of $200/month credit | Negligible (forests are geocoded once) | **$0** |
| Public Nominatim | Free (rate limited) | ~200 lookups per snapshot rebuild (only for new forests) | **$0** |
| **Total** | | | **~$3.65/year** |

---

## Implementation Order

### Milestone 1: Validate ✅ COMPLETE
- [x] Create `scrape-test.yml` GHA workflow
- [x] Run it and analyze results (6 iterations)
- [x] Determine scraping strategy: stealth + residential proxy + headed browser
- [x] Select and configure proxy service (Decodo AU, $3.50/GB)
- [x] Verify all 5 targets pass consistently from GHA

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
| Scraping: Forestry Corp | Playwright + stealth + Decodo AU proxy (headed/xvfb) | Cloudflare Turnstile requires residential IP + real browser with JS execution |
| Scraping: FCNSW closures | `fetch()` + Decodo AU proxy (`undici.ProxyAgent`) | AWS API Gateway blocks datacenter IPs; no browser needed |
| Scraping: RFS | Plain `fetch()` | No bot protection; proxy would waste bandwidth |
| Proxy service | Decodo (Smartproxy) Pay-As-You-Go | Cheapest per-GB ($3.50) for low-volume; AU residential endpoint; 12-month expiry |
| Browser context | Shared per-domain | Reuse session across same-domain pages; avoids re-challenging on harder pages |
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
| Cloudflare tightens bot detection | Proxy-browser method stops working | Monitor scrape-test results; try different proxy regions; try different stealth plugin versions; worst case: manual local scrape + commit |
| Decodo proxy service outage or shutdown | Scraping fails for 3/5 targets | Switch to alternative proxy (IPRoyal, Bright Data); credentials are easily rotated via GitHub Secrets |
| Proxy IP gets flagged by Cloudflare | Intermittent failures | Decodo rotates residential IPs per-request; retry logic in pipeline; different session on each run |
| Forestry Corporation changes page structure | Parser breaks, no data | Schema validation in GHA alerts via GitHub issue; parsers are already robust with fuzzy matching |
| Google API cost exceeds $200/month | Small bill | Set billing alerts; use Essentials tier ($0.005/req); or switch to OSRM (free) |
| Public Nominatim rate limits | Slow geocoding | Coordinates are cached; only new forests need geocoding; can also use Google Places |
| GHA scheduled runs are delayed | Data slightly stale | Acceptable for fire ban data; manual dispatch as backup |
| Proxy bandwidth costs increase | Annual cost rises | Current usage is ~1.13 GB/year; even at 2x price ($7/GB) would be ~$8/year |
