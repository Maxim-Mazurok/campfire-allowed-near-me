# Australia-Wide Campfire Data — Implementation Recommendations

## National Data Sources (Shared Across All States)

These national datasets eliminate the need for per-state equivalents in some categories:

### 1. Fire Danger Ratings & Total Fire Bans

**Esri Australia Hub — Fire Danger Ratings 4-Day Forecast**
- ArcGIS item: `b8505ee34f414a5a842b0f0a32ea3e94` (sublayer 5)
- REST endpoint (likely): `https://services.arcgis.com/.../FeatureServer/0/query`
- Data: Fire weather district boundaries + fire danger ratings + fire behaviour index for ALL Australian fire districts
- Synced from BOM
- Fields: district name, state, fire danger rating, FBI, total fire ban status, valid date range
- **This single national endpoint could provide total fire ban status for every state**
- Query: `/query?where=STATE='NSW'&outFields=*&f=geojson` (filter by state)

### 2. Protected Area Boundaries

**CAPAD — Collaborative Australian Protected Areas Database**
- ArcGIS FeatureServer: `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/CAPAD/FeatureServer/0`
- Contains: all protected areas in Australia (national parks, state forests, conservation reserves, etc.)
- Fields: name, state, type, IUCN category, area, tenure
- Queryable by state: `?where=STATE='VIC'`
- **This replaces the per-state FCNSW ArcGIS equivalent for all states**

### 3. BOM Fire Danger Ratings (Fallback)
- Per-state HTML pages at `https://www.bom.gov.au/{state}/forecasts/fire-danger-ratings.shtml`
- Already being used for NSW — same parser could work for all states

---

## Per-State Data Needs Summary

| State | Fire Ban Source | Park/Forest Boundaries | Campground Facilities | Campfire Rules | Closures |
|---|---|---|---|---|---|
| **NSW** | RFS (done) | FCNSW ArcGIS (done) | Forestry Corp (done) | Forestry Corp (done) | FCNSW (done) |
| **VIC** | CFA RSS (XML) | DataVic WFS/SHP | Parks VIC (scrape) | Seasonal + TFB logic | Parks VIC alerts (scrape) |
| **QLD** | QLD Fire Dept (scrape) | data.qld.gov.au (SHP) | parks.qld.gov.au (scrape) | Per-campground icons (scrape) | Park alerts (scrape) |
| **SA** | CFS website (scrape) | data.sa.gov.au (GeoJSON) | data.sa.gov.au (JSON API!) | Seasonal + per-park (scrape) | parks.sa.gov.au (scrape) |
| **WA** | data.wa.gov.au (GeoJSON!) | data.wa.gov.au (SHP) | Explore Parks WA (scrape) | Campfire conditions table! | DBCA incidents (GeoJSON) |
| **TAS** | TFS website (scrape) | TheList WFS | PWS park pages (scrape) | PWS alerts (scrape, ad-hoc) | PWS alerts (scrape) |
| **NT** | SecureNT (reverse-eng) | CAPAD national | nt.gov.au (scrape) | Fire ban + default rules | Park pages (scrape) |
| **ACT** | ESA homepage (scrape) | CAPAD / manual | Manual / static | 4 locations only (static) | ACT Parks (scrape) |

---

## Phased Implementation Plan

### Phase 1: National Infrastructure + ACT (Low effort, high value)
1. Integrate national ArcGIS fire danger ratings endpoint → get TFB status for all states
2. Integrate CAPAD for protected area boundaries across Australia
3. Add ACT (hardcoded 4 campfire locations + ESA TFB scraping)
4. Refactor pipeline to be state-aware (data model supports `state` field)

### Phase 2: Easy States (SA + WA)
5. **SA**: Integrate JSON parks API from data.sa.gov.au + conservation reserve GeoJSON
6. **SA**: Scrape CFS for fire ban status + fire danger season dates
7. **WA**: Scrape Explore Parks WA campfire conditions table (single page!)
8. **WA**: Integrate DFES open data for TFB areas (GeoJSON)
9. **WA**: Integrate DBCA forest blocks for boundaries

### Phase 3: Medium States (QLD + VIC)
10. **QLD**: Download protected areas from data.qld.gov.au
11. **QLD**: Scrape parks.qld.gov.au camping area pages (facilities + campfire status)
12. **QLD**: Reverse-engineer QLD Fire Dept fire ban map data source
13. **VIC**: Parse CFA RSS feeds for TFB + fire danger ratings
14. **VIC**: Download forest management area boundaries from DataVic
15. **VIC**: Scrape Parks Victoria for campground facilities
16. **VIC**: Implement Fire Danger Period logic per municipality

### Phase 4: Hard States (TAS + NT)
17. **TAS**: Scrape TFS for total fire bans
18. **TAS**: Query TheList WFS for campground/reserve boundaries
19. **TAS**: Scrape PWS for per-park campfire rules and alerts
20. **NT**: Reverse-engineer SecureNT fire ban endpoint
21. **NT**: Scrape nt.gov.au park pages for campground facilities
22. **NT**: Handle NT's unique cooking-fire-during-ban exception

---

## Architecture Changes Needed

### Data Model Extensions
```typescript
interface ForestPoint {
  // Existing fields...
  state: "NSW" \| "VIC" \| "QLD" \| "SA" \| "WA" \| "TAS" \| "NT" \| "ACT";
  parkType: "STATE_FOREST" \| "NATIONAL_PARK" \| "CONSERVATION_RESERVE" \| "RECREATION_AREA" \| "OTHER";
  
  // New: per-state campfire status could have different semantics
  campfireStatus: {
    status: "ALLOWED" \| "RESTRICTED" \| "BANNED" \| "NOT_ALLOWED" \| "UNKNOWN";
    reason: string; // e.g., "Total Fire Ban", "Fire Danger Season", "Permanent restriction"
    source: string; // e.g., "CFA RSS", "Parks VIC scrape", etc.
  };
}
```

### Pipeline Changes
- Make pipeline state-aware: each state has its own scraper/parser chain
- National data (CAPAD, fire danger) fetched once, shared across states
- Per-state enrichment runs in parallel
- Final assembly merges all states into one snapshot

### Key Decisions Needed
1. **Do we show all public land types?** (national parks, state forests, conservation reserves) or only forests?
2. **How to handle states without "Solid Fuel Fire Ban"?** — Need a unified campfire status model
3. **How to handle different fire ban granularities?** (fire weather districts vs LGAs vs regions)
4. **Scraping budget** — More states = more scraping targets = more proxy cost/maintenance

---

## Estimated Scale

| State | Forests/Parks | Campgrounds | Scrape Targets | Antibot? |
|---|---|---|---|---|
| NSW | ~200 state forests | ~100+ | 3 sites | Cloudflare (Forestry Corp) |
| VIC | ~150 parks + state forests | ~200+ | 2 sites | No |
| QLD | ~300+ parks/forests | ~400+ | 2 sites | No |
| SA | ~110 parks | ~80+ | 2 sites | No |
| WA | ~100 parks | ~100 | 2 sites | No |
| TAS | ~50 parks | ~60 | 2 sites | No |
| NT | ~80 parks | ~40 | 2 sites | Possible |
| ACT | ~5 parks | ~4 | 1 site | No |
| **Total** | **~1000+** | **~980+** | **~16 sites** | **1 confirmed** |
