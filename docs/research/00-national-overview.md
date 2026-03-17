# Australia-Wide Campfire Data Coverage — National Overview

## Current State (NSW Only)

The system currently collects 4 categories of data for NSW:

| Data Category | NSW Source | Description |
|---|---|---|
| **Forest/Park Locations & Boundaries** | FCNSW ArcGIS FeatureServer | Polygon geometry for state forests |
| **Facilities** | Forestry Corp directory pages | Camping, toilets, walking tracks, etc. |
| **Campfire/Solid Fuel Fire Bans** | Forestry Corp fire-bans page | Per-area ban status on state forest campfires |
| **Total Fire Bans (statewide)** | RFS XML + GeoJSON feeds | Per-district total fire ban status & geometry |
| **Closures** | FCNSW closure listing | Forest closures affecting access/camping |

## National Strategy: Key Data Sources Per Category

### 1. Fire Danger Ratings & Total Fire Bans (ALL STATES)

**National ArcGIS FeatureServer** — the single most important discovery:

- **Esri Australia Hub – Fire Danger Ratings 4-Day Forecast**
  - URL: `https://www.esriaustraliahub.com.au/datasets/fire-danger-ratings-4-day-forecast`
  - ArcGIS item ID: `b8505ee34f414a5a842b0f0a32ea3e94` (sublayer 5)
  - Contains: Fire Weather Forecast Area boundaries + 4-day fire danger ratings for **every fire district in Australia**
  - Fields include: district name, state, fire danger rating, fire behaviour index, total fire ban status, date ranges
  - Format: ArcGIS FeatureServer (queryable REST API returning GeoJSON)
  - This single endpoint could replace the per-state total fire ban scraping entirely

- **Bureau of Meteorology** publishes per-state fire danger rating pages (HTML, parseable)
  - `https://www.bom.gov.au/{state}/forecasts/fire-danger-ratings.shtml`
  - States: nsw (combined with ACT), vic, qld, sa, wa, tas, nt

### 2. Protected Area Boundaries (ALL STATES)

**CAPAD – Collaborative Australian Protected Areas Database**
- National dataset with boundaries for all protected areas (national parks, state forests, nature reserves)
- ArcGIS FeatureServer: `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/CAPAD/FeatureServer/0`
- Also available from Digital Atlas: `https://digital.atlas.gov.au/datasets/collaborative-australian-protected-areas-database-capad-terrestrial`
- Includes: park name, type (national park, state forest, conservation reserve, etc.), state, IUCN category, area
- This provides the base geometry layer for every state

### 3. Per-State Detailed Data

Each state has unique sources for:
- Campground/facilities listings
- Park-specific fire restrictions (beyond total fire bans)
- Closure information
- Camping booking systems

See individual state reports for details.

## Architecture Recommendation

```
┌──────────────────────────────────────┐
│  NATIONAL LAYER (all states)         │
│  • CAPAD boundaries (ArcGIS)         │
│  • BOM/Esri fire danger ratings      │
│  • BOM fire weather districts        │
└──────────────┬───────────────────────┘
               │
┌──────────────▼───────────────────────┐
│  PER-STATE ENRICHMENT                │
│  • Campground facilities             │
│  • Park-specific fire restrictions   │
│  • Closures & alerts                 │
│  • Campfire-allowed status           │
└──────────────────────────────────────┘
```

## Complexity Assessment Per State

| State | Fire Ban Data | Forest/Park Data | Facilities Data | Campfire Rules | Overall Difficulty |
|---|---|---|---|---|---|
| **NSW** | ★★★★★ (done) | ★★★★★ (done) | ★★★★★ (done) | ★★★★★ (done) | Done |
| **VIC** | ★★★★☆ (RSS feed) | ★★★★☆ (DataVic) | ★★★☆☆ (scrape) | ★★★☆☆ (seasonal) | Medium |
| **QLD** | ★★★☆☆ (scrape) | ★★★★★ (open data) | ★★★★★ (rich HTML) | ★★★★☆ (per-park) | Medium |
| **SA** | ★★★★☆ (open data) | ★★★★★ (open data) | ★★★★★ (JSON API) | ★★★☆☆ (seasonal) | Easy-Medium |
| **WA** | ★★★★★ (open data) | ★★★★☆ (open data) | ★★★★☆ (table scrape) | ★★★★★ (table!) | Easy-Medium |
| **TAS** | ★★☆☆☆ (scrape) | ★★★★☆ (LIST) | ★★★☆☆ (scrape) | ★★☆☆☆ (alerts scrape) | Hard |
| **NT** | ★★☆☆☆ (scrape) | ★★★☆☆ (limited) | ★★★☆☆ (scrape) | ★★☆☆☆ (limited) | Hard |
| **ACT** | ★★★★☆ (simple) | ★★★★★ (tiny area) | ★★★★☆ (few parks) | ★★★★★ (simple) | Easy |

## Recommended Implementation Order

1. **ACT** — Tiny territory, only ~4 campfire locations, shares fire danger data with NSW
2. **SA** — Excellent open data (JSON parks API, fire ban districts with geometry)
3. **WA** — Great campfire conditions table on Explore Parks WA, open fire ban data
4. **QLD** — Rich parks data, per-park campfire info in HTML, open boundaries data
5. **VIC** — RSS fire ban feeds, but campfire rules are seasonal/complex
6. **TAS** — PWS alerts-based campfire bans, limited structured data
7. **NT** — Most limited digital infrastructure, fire bans via SecureNT scraping
