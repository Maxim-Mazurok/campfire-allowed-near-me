# South Australia (SA) — Data Source Research Report

## Overview

South Australia's parks are managed by the **National Parks and Wildlife Service South Australia (NPWSSA)**, under the Department for Environment and Water (DEW). Fire bans are managed by the **SA Country Fire Service (CFS)**. SA has **15 fire ban districts**.

---

## 1. Total Fire Bans & Fire Danger Ratings

### CFS Total Fire Bans
- **Website**: `https://www.cfs.sa.gov.au/warnings-restrictions/restrictions/total-fire-bans-ratings/`
- Total Fire Bans declared for days when Fire Danger Rating is Extreme or Catastrophic
- Can be declared for individual fire ban districts or statewide
- CFS Bushfire Information Hotline: 1800 362 361

### SA Fire Ban Districts (Open Data — Excellent)
- **data.sa.gov.au**: `https://data.sa.gov.au/data/dataset/south-australian-fire-ban-districts`
- Contains: 15 fire weather districts used by BOM and CFS
- Geometry boundaries available — **can be used for point-in-polygon lookups**
- This is equivalent to what we do for NSW with RFS fire weather areas

### CFS Fire Danger Season Dates
- `https://www.cfs.sa.gov.au/warnings-restrictions/restrictions/fire-danger-season-dates-permits/`
- Published seasonal dates per district
- Fire Danger Season typically November–April
- **During Fire Danger Season**: campfires are banned in all SA parks

### BOM Fire Danger Ratings
- `https://www.bom.gov.au/sa/forecasts/fire-danger-ratings.shtml`
- HTML table per district

### Data Feed
- CFS does not appear to have a public RSS/XML feed like CFA (Victoria)
- Fire ban status would likely need to be **scraped from the CFS website**
- The national ArcGIS fire danger ratings layer covers SA districts

---

## 2. Forest/Park Locations & Boundaries

### Conservation Reserve Boundaries (Open Data — Excellent)
- **data.sa.gov.au**: `https://data.sa.gov.au/data/dataset/conservation-reserve-boundaries`
- **Formats**: SHP, KMZ, GeoJSON
- **License**: Creative Commons Attribution
- **Updated**: annually
- Contains boundaries of all conservation lands in SA
- These are the SA equivalents of NSW state forests + national parks

### Conservation Reserve Parcels
- Separate dataset with DCDB (cadastral) parcels dedicated to conservation
- Available on data.sa.gov.au

---

## 3. Camping & Facilities Data

### SA Parks — Features and Facilities Dataset (Open Data — Excellent)
- **data.sa.gov.au**: `https://data.sa.gov.au/data/dataset/south-australian-parks-features-and-facilities`
- **Format**: JSON API
- **License**: Creative Commons Attribution
- **Content**: 110+ parks with features and facilities
- This is a **direct JSON download** — no scraping needed!
- Likely contains: park name, activities, facilities (toilets, BBQs, fireplaces, camping, etc.)

### parks.sa.gov.au Website
- **Find a Park**: searchable by name, activities, facilities
- **Campfire info page**: `https://www.parks.sa.gov.au/know-before-you-go/campfires-and-bbqs`
- **Full list of park fire restrictions**: linked from the campfire info page
- Individual park pages show: access type, campsite details, facilities, campfire rules
- Example data pattern: "Campfires: allowed (seasonal fire restrictions apply)"

### Park Details Available Per Site
From scraping individual park pages:
- Access: 2WD, high clearance 2WD, 4WD
- Suitable for: tents, camper trailers, caravans
- Facilities: nil, toilets, BBQ, picnic tables, showers
- Campfires: allowed/not allowed + seasonal notes
- Number of campsites
- Electricity: powered/unpowered

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in South Australia

SA has the **strictest baseline rules** of any Australian state:

1. **Total Fire Ban days** → ALL fires banned including gas/liquid fuel BBQs (only exception: fixed park BBQs in some parks)
2. **Fire Danger Season** (Nov–Apr typically) → Campfires banned in **all parks** statewide
3. **Outside Fire Danger Season** → Campfires allowed only where stated per park, in designated fire pits

### Unique SA Feature
- During Total Fire Ban, even gas BBQs are banned (unlike most other states)
- Only fixed BBQ facilities in certain parks may still be used on TFB days
- This needs to be clearly communicated to users

### Park Fire Restrictions List
- SA publishes a "full list of park fire restrictions" showing per-park rules
- Would need to scrape this for the per-park campfire status outside fire danger season

---

## 5. Closures

### Park Closures & Alerts
- `https://www.parks.sa.gov.au/know-before-you-go/closures-and-alerts`
- Closures for fire danger and prescribed burns on the "Fire pages"
- No structured API — requires scraping

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Total fire ban status | CFS website | Scrape | HTML | Medium |
| Fire ban district geometry | data.sa.gov.au | Download | SHP/GeoJSON | Easy |
| Fire danger season dates | CFS website | Scrape | HTML | Medium |
| Fire danger ratings | BOM or national ArcGIS | `fetch()` | HTML/GeoJSON | Easy |
| Park/reserve boundaries | data.sa.gov.au | Download | GeoJSON/SHP | Easy |
| Park features & facilities | data.sa.gov.au | `fetch()` | JSON | **Very Easy** |
| Per-park campfire rules | parks.sa.gov.au | Scrape | HTML | Medium |
| Park closures | parks.sa.gov.au | Scrape | HTML | Medium |

## 7. Campfire Status Logic (South Australia)

```
IF totalFireBan = DECLARED for this district
  → BANNED (no fires at all, including most BBQs)
ELSE IF fireDangerSeason = ACTIVE
  → BANNED (all campfires banned statewide in parks during fire season)
ELSE IF park.campfiresAllowed = false
  → NOT_ALLOWED (permanent per-park rule)
ELSE
  → ALLOWED (in designated fire pits only)
```

## 8. Challenges & Notes

- SA has the best open data situation after WA — the JSON parks API is fantastic
- Fire Danger Season creates a simple binary: during season = no campfires in any park
- CFS does not publish a structured data feed; need to scrape their website for current TFB status
- The conservation reserve boundaries dataset in GeoJSON format is directly usable
- SA parks include not just national parks but also conservation parks, recreation parks, game reserves
- The "full list of park fire restrictions" page is the key scraping target for per-park campfire rules
- SA's strictest-in-Australia TFB rules (banning even gas BBQs) need special handling in the UI
