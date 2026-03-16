# Queensland (QLD) — Data Source Research Report

## Overview

Queensland's parks and forests are managed by **Queensland Parks and Wildlife Service (QPWS)**, under the Department of Environment, Tourism, Science and Innovation. Fire bans are managed by the **Queensland Fire Department** (formerly QFES). Queensland uses **Local Fire Bans** by Local Government Area (LGA), not statewide total fire bans like other states.

---

## 1. Fire Bans & Fire Danger Ratings

### Queensland Fire Department — Fire Bans
- **Website**: `https://www.fire.qld.gov.au/safety-education/using-fire-outdoors/fire-bans-and-restrictions`
- Two types of fire restrictions:
  - **Local Fire Ban** — declared for specific LGAs
  - **State of Fire Emergency** — extreme statewide measure (very rare)
- The website has an interactive map where you can search by address/LGA
- **No public API discovered** — the map appears to be loaded via JavaScript
- Each LGA has its own page: `https://www.fire.qld.gov.au/fire-bans/{lga-slug}`
- Would need to **scrape or reverse-engineer the map data source**

### BOM Fire Danger Ratings
- `https://www.bom.gov.au/qld/forecasts/fire-danger-ratings.shtml`
- HTML table with per-district ratings (Central Coast and Whitsundays, Darling Downs and Granite Belt, etc.)

### National ArcGIS Layer
- The Esri Australia Hub national fire danger ratings layer includes QLD districts

### QPWS Fire Advisories (Open Data)
- `https://www.data.qld.gov.au/dataset/queensland-parks-and-wildlife-service-fire-advisories`
- Point data for wildfires and planned burns on/around QPWS estate
- Format: KML
- Not directly useful for ban status, but useful for active fire awareness

---

## 2. Forest/Park Locations & Boundaries

### Protected Areas of Queensland Series (Open Data — Excellent)
- `https://www.data.qld.gov.au/dataset/protected-areas-of-queensland-series`
- **Formats**: SHP, TAB, FGDB, KMZ, GPKG
- **License**: Creative Commons Attribution 4.0
- **Last updated**: July 2025
- Contains:
  - **Protected areas of Queensland** — all national parks, conservation parks, state forests, recreation areas
  - **Protected areas boundaries** — separate boundary polygons
  - **Special management areas — forestry** — forestry-specific management zones
- This is the **primary geometry source** for QLD

### QPWS Fire Management Zones
- `https://www.data.qld.gov.au/dataset/queensland-parks-and-wildlife-service-fire-management-zones`
- Shows fire management purpose zones within reserves
- CC BY 4.0

---

## 3. Camping & Facilities Data

### QPWS Parks Website — Rich Per-Park Data
- **Find a park**: `https://parks.qld.gov.au/find-a-park`
- **Find a camping area**: `https://parks.qld.gov.au/camping`
- **A-Z camping listing**: Individual camping area pages with structured icons
- Each camping area page shows:
  - Tent camping ✓/✗
  - Caravan camping ✓/✗
  - Camper trailer ✓/✗
  - **Campfires allowed ✓/✗** (per camping area!)
  - Toilets ✓/✗
  - Showers ✓/✗
  - BBQ ✓/✗
  - Picnic tables ✓/✗
  - Wheelchair access ✓/✗
  - Generators ✓/✗
  - Dogs permitted ✓/✗

**This is exceptionally rich data — campfire allowed/not-allowed is listed per individual camping area!**

### Scraping Strategy
- The A-Z listing can be scraped to get all camping areas
- Each area shows facility icons in a consistent HTML pattern
- Pattern observed: `Campfires allowed` or `No campfires` as text alongside icons
- This is cleaner than NSW's approach — QLD publishes per-campground campfire status

### QPWS Camping Permits (Open Data)
- `https://www.data.qld.gov.au/dataset/camping-and-vehicle-permits`
- Quarterly CSV dumps of permits issued
- Contains: park names, camping area names, dates
- Not directly useful for facilities but valuable for identifying active campgrounds

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in Queensland

QLD has a **three-tier** campfire restriction system:

1. **Queensland Fire Department Local Fire Ban** → All campfires banned in affected LGAs
2. **QPWS Fire Prohibition** (park-specific) → No campfires in specific parks/forests
   - Can be long-term or permanent for habitat protection
   - Advertised on park alerts and signs
   - Gas/manufactured fuel appliances still allowed with conditions
3. **Default per-camping-area rule** → Campfire "allowed" or "not allowed" per site

### QPWS Park Alerts
- `https://parks.qld.gov.au/park-alerts`
- Individual park pages show current alerts including fire prohibitions
- Would need to **scrape park alert pages** for current fire prohibitions

### Key Distinction from NSW
- QLD does NOT have a "Solid Fuel Fire Ban" system per forestry area
- Instead, campfire permission is listed **per individual camping area**
- QPWS can impose fire prohibitions on specific parks independently of Queensland Fire Dept

---

## 5. Closures

### Park Alerts System
- Closures, fire prohibitions, and other alerts are published on individual park pages
- `https://parks.qld.gov.au/park-alerts` (aggregate list)
- No structured API — requires scraping

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Local fire bans | QLD Fire Dept website | Scrape/reverse-engineer map | HTML/JS | Hard |
| Fire danger ratings | BOM or national ArcGIS | `fetch()` | HTML/GeoJSON | Easy |
| Park/forest boundaries | data.qld.gov.au | Download | SHP/GPKG | Easy |
| Camping area list | parks.qld.gov.au A-Z | Scrape | HTML | Medium |
| Facilities per campground | parks.qld.gov.au pages | Scrape | HTML (icons) | Medium |
| Campfire allowed per site | parks.qld.gov.au pages | Scrape | HTML (icons) | Medium |
| Park fire prohibitions | parks.qld.gov.au alerts | Scrape | HTML | Medium |
| Fire management zones | data.qld.gov.au | Download | SHP/GPKG | Easy |

## 7. Campfire Status Logic (Queensland)

```
IF localFireBan = DECLARED for this LGA
  → BANNED (Queensland Fire Dept ban overrides everything)
ELSE IF qpwsFireProhibition = ACTIVE for this park/forest
  → BANNED (QPWS park-specific prohibition)
ELSE IF campingArea.campfiresAllowed = false
  → NOT_ALLOWED (permanent per-site rule)
ELSE
  → ALLOWED (in designated fire rings/fireplaces)
```

## 8. Challenges & Notes

- QLD fire bans are per-LGA, not per-fire-weather-district — different geographic granularity
- QPWS fire prohibitions are independent of QLD Fire Dept bans — need to check both
- The parks website is very well structured with consistent icon patterns — good for scraping
- No Cloudflare protection observed on parks.qld.gov.au
- The protected areas dataset is excellent quality open data
- Some camping areas are within state forests (not just national parks)
- QLD has both "Local Fire Bans" and "State of Fire Emergency" — the latter is extremely rare
