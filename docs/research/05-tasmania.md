# Tasmania (TAS) — Data Source Research Report

## Overview

Tasmania's parks are managed by the **Parks & Wildlife Service (PWS)**, part of the Department of Natural Resources and Environment Tasmania (NRE Tas). Fire bans are managed by the **Tasmania Fire Service (TFS)**. Tasmania has 3 fire regions: Northern, Southern, and ???.

---

## 1. Total Fire Bans & Fire Danger Ratings

### Tasmania Fire Service (TFS)
- **Total Fire Ban page**: `https://www.fire.tas.gov.au/Show?pageId=colFireBan`
- TFS can declare Total Fire Bans by region (Northern, Southern, or statewide)
- During TFB: no fires permitted in the open (including campfires, incinerators, burn-offs, fire pots, wood-fired stoves)
- **No public API or data feed discovered** — would need to **scrape the TFS website**

### Fire Danger Rating Maps
- `https://www.fire.tas.gov.au/fire-danger-rating/maps/`
- Visual maps showing fire danger ratings
- No structured data endpoint found

### BOM Fire Danger Ratings
- `https://www.bom.gov.au/tas/forecasts/fire-danger-ratings.shtml`

### National ArcGIS Layer
- Tasmania fire weather districts included in the national Esri Australia Hub layer

---

## 2. Forest/Park Locations & Boundaries

### TheList Tasmania — Campgrounds Dataset
- **TheList** (Tasmania's spatial data portal): `https://www.thelist.tas.gov.au`
- **Campground/site dataset**: Contains spatial point and polygon locations of camping and caravan grounds in Tasmania
- Has a "Type" attribute for classification
- Available via TheList data services (WFS/WMS)

### Reserve Boundaries
- Tasmania's reserve boundaries available via TheList spatial datasets
- Includes national parks, state reserves, conservation areas, state forests
- **LISTmap**: Interactive map viewer for exploring spatial data
- WFS endpoints available for programmatic access

### CAPAD (National)
- All Tasmanian protected areas in the national database

---

## 3. Camping & Facilities Data

### Parks & Wildlife Service Tasmania
- **Where to stay**: `https://parks.tas.gov.au/where-to-stay`
- Campground and hut accommodation searchable by region
- **Explore our parks**: `https://parks.tas.gov.au/explore-our-parks`
- Browse all parks with map interface

### Park Pages
- Each park page lists camping options and facilities
- Campfire status per park appears to be conveyed via:
  - Park-level rules
  - Seasonal campfire bans announced via alerts
  - "Fuel Stove Only" designations for sensitive areas (Wilderness World Heritage Area, alpine regions)

### No Public API
- PWS does not appear to have a structured API for campground data
- Would need to **scrape park pages** for facilities and campfire rules

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in Tasmania

Tasmania has a **complex, multi-layered** system:

1. **Total Fire Ban** (TFS, by region) → All outdoor fires banned statewide or per-region
2. **PWS seasonal campfire bans** → Parks & Wildlife can ban campfires in specific parks/areas
   - Announced via the PWS website and park alerts
   - Example: "Campfires will be banned in all national parks and reserves in the Tasman municipal area from 2am on Friday 16 January 2026"
3. **Fuel Stove Only areas** → Permanent restrictions in:
   - Wilderness World Heritage Areas
   - Alpine regions
   - Other sensitive environments
4. **Default** → Campfires allowed in designated fire rings at campgrounds

### PWS Campfire Page
- `https://parks.tas.gov.au/explore-our-parks/know-before-you-go/campfires-and-fire-bans`
- On Total Fire Ban days: all outdoor fires prohibited (including wood, charcoal, portable stoves, solid fuel)
- PWS can extend seasonal bans to specific campgrounds

### Key Challenge
- Campfire bans in TAS are announced ad-hoc via alerts, not published as a structured dataset
- PWS extends bans to specific campgrounds individually (e.g., "Lime Bay, Mill Creek and Banksia campgrounds")
- Need to monitor the PWS alerts/news feed for changes

---

## 5. Closures

### Park Alerts
- PWS publishes alerts for park closures, track closures, campfire bans
- Available on the PWS website — no structured API
- Would need regular scraping of the alerts page

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Total fire ban status | TFS website | Scrape | HTML | Medium-Hard |
| Fire danger ratings | BOM or national ArcGIS | `fetch()` | HTML/GeoJSON | Easy |
| Park/reserve boundaries | TheList WFS | WFS query | GeoJSON | Medium |
| Campground locations | TheList spatial data | WFS query | GeoJSON | Medium |
| Campground facilities | PWS park pages | Scrape | HTML | Hard |
| Campfire rules per park | PWS park pages + alerts | Scrape + monitor | HTML | Hard |
| Fuel stove only areas | PWS park pages | Scrape | HTML | Medium |
| Park closures | PWS alerts | Scrape | HTML | Medium |

## 7. Campfire Status Logic (Tasmania)

```
IF totalFireBan = DECLARED for this region (TFS)
  → BANNED
ELSE IF pwsSeasonalBan = ACTIVE for this park/campground
  → BANNED (PWS-imposed seasonal ban)
ELSE IF fuelStoveOnly = true for this area
  → NOT_ALLOWED (permanent fuel stove only designation)
ELSE
  → ALLOWED (in designated fire rings)
```

## 8. Challenges & Notes

- Tasmania is one of the **hardest states** to automate due to ad-hoc alert-based campfire bans
- TFS has no public data feed for total fire bans — scraping required
- PWS campfire bans are announced as news items, not in a structured database
- The Wilderness World Heritage Area has permanent fuel-stove-only rules
- TheList spatial data portal has good geometry data but requires WFS expertise
- Relatively small number of managed campgrounds (~50-60 across the state)
- Tasmania's compact size means a single TFB often affects most parks
- Consider monitoring PWS Facebook page as an additional alert source
- The PWS website doesn't appear to have antibot protection
