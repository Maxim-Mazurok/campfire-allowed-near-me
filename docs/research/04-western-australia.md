# Western Australia (WA) — Data Source Research Report

## Overview

Western Australia's parks and forests are managed by the **Department of Biodiversity, Conservation and Attractions (DBCA)** via the **Parks and Wildlife Service**. Fire bans are managed by the **Department of Fire and Emergency Services (DFES)** via **EmergencyWA**. WA is vast (2.5M km²) with limited camping infrastructure compared to eastern states.

---

## 1. Total Fire Bans & Fire Danger Ratings

### DFES EmergencyWA Total Fire Ban Areas (Open Data — Excellent)
- **data.wa.gov.au**: `https://catalogue.data.wa.gov.au/dataset/dfes-emergencywa-total-fire-ban-areas-dfes-067`
- Contains: Active Local Government Authority (LGA) boundaries where a Total Fire Ban has been declared or revoked
- This is a **GeoJSON/spatial endpoint** with live data
- WA uses LGA boundaries for total fire bans (not fire weather districts)
- License: CC BY (likely)

### DFES Total Fire Ban Page
- `https://www.dfes.wa.gov.au/hazard-information/bushfire/total-fire-ban`
- Declares TFBs per LGA — detailed text announcements on social media and website

### BOM Fire Danger Ratings
- `https://www.bom.gov.au/wa/forecasts/fire-danger-ratings.shtml`
- HTML table: many districts (North Interior, Exmouth Gulf Coast, Gascoyne Inland, Midwest Inland, Lesueur, Swan Inland South, Blackwood, etc.)
- WA has the **most fire weather districts** of any state due to its size

### National ArcGIS Layer
- Covers all WA fire weather districts

---

## 2. Forest/Park Locations & Boundaries

### Forest Blocks (DBCA-025) — Open Data
- `https://catalogue.data.wa.gov.au/dataset/forest-blocks`
- Administrative boundaries for DBCA Sustainable Forest Management
- Mainly covers the SW corner of WA (karri, jarrah, tuart forests)

### DBCA Region Boundaries (DBCA-024)
- `https://catalogue.data.wa.gov.au/dataset/dbca-region-boundaries`
- Administrative region polygons

### DBCA District Boundaries (DBCA-023)
- District-level management polygons

### Regional Parks (DBCA-026)
- `https://catalogue.data.wa.gov.au/dataset/regional-parks`
- Open spaces of regional significance for conservation + recreation

### CAPAD (National)
- All WA protected areas available via national CAPAD FeatureServer

---

## 3. Camping & Facilities Data

### Explore Parks WA — Campfire Conditions Table (Excellent!)
- **URL**: `https://exploreparks.dbca.wa.gov.au/current-campfire-conditions`
- This is the **best single data source** found in any state
- Contains an HTML table listing **every campground** with:
  - Campground name (link to detail page)
  - Park name
  - **Current campfire status**: "Campfires permitted" / "Campfire ban" / "No campfires at any time"
  - Seasonal notes
- Updated dynamically — reflects current conditions including any imposed bans
- Can be **scraped with a simple HTML parser** — no antibot protection observed

### Explore Parks WA — Campground Detail Pages
- `https://exploreparks.dbca.wa.gov.au/camping`
- Each campground page includes:
  - Facilities: toilets, water, BBQ, picnic tables
  - Whether campfires are usually permitted
  - Access info (2WD/4WD)
  - Booking requirements
- Campground facilities page: `https://exploreparks.dbca.wa.gov.au/campground-facilities`
- About 100 campgrounds across the state

### Booking System
- WA uses the Parks booking system via `parkstay.dbca.wa.gov.au`
- Booking data not publicly accessible as API

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in Western Australia

Three-tier system:

1. **Total Fire Ban** (DFES, per-LGA) → All campfires banned
2. **DBCA-imposed campfire bans** (park/campground specific) → Seasonal or condition-based
3. **Permanent no-campfire campgrounds** → Some sites never allow campfires
4. **Default** → Campfires permitted seasonally at designated campgrounds

### Campfire Conditions Table
- The `current-campfire-conditions` page is the authoritative real-time source
- DBCA can impose bans without notice at any time based on conditions
- Campfires are never permitted in national parks/conservation reserves for firewood collection

### Restricted Season
- WA's "restricted burning times" vary by LGA (typically November–March in the south)
- During restricted periods, permits may be required for fires

---

## 5. Closures

### Park Alerts
- Alert information available on Explore Parks WA
- DBCA Incident Mapping available on data.wa.gov.au (active fire incidents)
- `https://catalogue.data.wa.gov.au/dataset/dbca-incident-mapping-polygons-dbca-089`

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Total fire ban status | data.wa.gov.au DFES-067 | `fetch()` | GeoJSON | **Very Easy** |
| Fire danger ratings | BOM or national ArcGIS | `fetch()` | HTML/GeoJSON | Easy |
| Forest/park boundaries | data.wa.gov.au DBCA | Download | SHP/GeoJSON | Easy |
| Campfire conditions | Explore Parks WA table | Scrape | HTML table | **Easy** |
| Campground list | Explore Parks WA | Scrape | HTML | Easy-Medium |
| Facilities per campground | Explore Parks WA detail | Scrape | HTML | Medium |
| Park closures/incidents | data.wa.gov.au DBCA-089 | `fetch()` | GeoJSON | Easy |

## 7. Campfire Status Logic (Western Australia)

```
IF totalFireBan = DECLARED for this LGA (DFES)
  → BANNED
ELSE IF currentCampfireCondition = "Campfire ban" (from DBCA table)
  → BANNED (DBCA-imposed seasonal/conditional ban)
ELSE IF currentCampfireCondition = "No campfires at any time"
  → NOT_ALLOWED (permanent rule)
ELSE IF currentCampfireCondition = "Campfires permitted"
  → ALLOWED (in designated fire rings only)
```

## 8. Challenges & Notes

- WA has probably the **easiest data acquisition** path of all non-NSW states
- The campfire conditions table is a single scrape target giving campfire status for all campgrounds
- DFES total fire ban data is open data with GeoJSON geometry — perfect for point-in-polygon
- WA uses LGA boundaries for TFBs, not fire weather districts — different from NSW approach
- Only ~100 campgrounds statewide (much fewer than QLD or VIC)
- Most camping is in the southwest; vast northern areas have very few managed campgrounds
- Firewood collection banned in all conservation reserves — must bring your own
- No Cloudflare or antibot protection observed on Explore Parks WA
