# Northern Territory (NT) — Data Source Research Report

## Overview

The Northern Territory's parks are managed by **Parks and Wildlife** (part of the NT Government). Fire management is split between **Bushfires NT** (rural/remote areas, fire protection zones) and **NT Fire and Rescue Service (NTFRS)** (urban/emergency response areas). The NT has 5 fire management zones: Alice Springs, Arnhem, Barkly, Savanna, Vernon Arafura.

---

## 1. Fire Bans & Fire Danger Ratings

### SecureNT — Fire Ban Information
- **URL**: `https://securent.nt.gov.au/`
- Fire bans are declared for **fire weather forecast areas** (not LGAs)
- Can apply to whole or part of the NT
- Usually midnight to midnight (24-hour)
- During a fire ban: no fires in open air, all permits void
- **Exception**: small cooking fires allowed if fully attended, 4m clearance, extinguished immediately after

### SecureNT — Data Feed Discovery
- The SecureNT website appears to **fetch fire ban data via JavaScript**
- Code pattern found on the page:
  ```javascript
  function fetchData() { ... }
  // Shows: "There are no fire bans declared for NT on this date."
  ```
- This suggests there IS a **backend API endpoint** that returns current fire ban data
- Would need to **reverse-engineer the fetch endpoint** from the page's JavaScript
- The JavaScript parses date strings and notice numbers from URLs

### Bushfires NT Alerts
- `https://securent.nt.gov.au/` — Bushfires NT alerts section
- Includes alert list with dates
- Fire incident map provided by NTFRS and Bushfires NT

### Fire Danger Periods
- Declared separately for Top End and Central Australia
- Different timing based on rain, grassland curing, local conditions
- Declarations published as PDFs on SecureNT

### BOM Fire Danger Ratings
- `https://www.bom.gov.au/nt/forecasts/fire-danger-ratings.shtml`

### National ArcGIS Layer
- NT fire weather districts included

---

## 2. Forest/Park Locations & Boundaries

### Parks and Reserves
- The NT has **80+ parks and reserves** across the territory
- Park list: `https://nt.gov.au/leisure/parks-reserves`
- Organized by region:
  - Darwin region
  - Greater Darwin region
  - Katherine region
  - Barkly and Tennant Creek region
  - Alice Springs region
  - Central Australia

### Park Maps
- Parks encourage using the **Avenza Maps** app for offline park maps
- **NR Maps** (Natural Resource Maps): interactive map at `https://nrmaps.nt.gov.au/`
- Contains fire management boundary layers

### Fire Management Boundaries
- Available as PDF: "Fire management boundaries within the NT" (745.8 KB PDF)
- Also viewable on NR Maps (interactive)
- 5 fire management zones with separate bushfire management plans

### Limited Spatial Open Data
- NT's open data portal is less developed than other states
- No dedicated spatial dataset for park boundaries found on data.nt.gov.au
- CAPAD national layer covers NT protected areas

---

## 3. Camping & Facilities Data

### NT Parks Camping
- **Camping page**: `https://nt.gov.au/leisure/parks-reserves/camping`
- All campgrounds listed with categories:
  - **Category A**: Moderate facilities (showers, toilets, BBQs, tap water) — $15/adult
  - **Category B**: Basic-moderate (toilets, tables, BBQs, water) — $10/adult
  - **Category C**: Commercial operators
  - **Category D**: Premium exclusive sites — $20/adult

### Booking System
- Online booking required for designated campsites: `https://parkbookings.nt.gov.au/`
- Cannot pay at the park

### Campground Information Sheet
- "Camping in NT parks information sheet" PDF (2.5 MB) — downloadable
- Contains list of campgrounds and facilities

### Individual Park Pages
- Each park page includes:
  - Camping areas and facilities
  - Access information
  - Fire safety rules
  - Whether fireplaces/fire pits are provided

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in the Northern Territory

The NT has the **simplest default rules** but complex administrative boundaries:

1. **Fire Ban** (Bushfires NT or NTFRS, per fire weather area) → No fires in open air
   - Exception: small cooking fires with strict conditions (attended, 4m clearance, extinguished after cooking)
2. **Fire Danger Period** → Permits required for any burning; all permits void during fire bans
3. **Default** → Campfires allowed in provided fireplaces/fire pits at campgrounds

### Key Differences
- NT allows small cooking fires even during fire bans (unique among states)
- Fire management is split between Bushfires NT (rural) and NTFRS (urban areas)
- The "dry season" brings high fire danger (opposite seasonal pattern to southern states)

---

## 5. Closures

### Seasonal Closures
- Many parks close during wet season (November–April in the Top End)
- Closures due to flooding, crocodile danger, track conditions
- Published on individual park pages

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Fire ban status | SecureNT | Reverse-engineer JS endpoint | JSON (likely) | Medium-Hard |
| Fire danger ratings | BOM or national ArcGIS | `fetch()` | HTML/GeoJSON | Easy |
| Fire management zones | NR Maps / CAPAD | Download/WFS | Various | Medium |
| Park boundaries | CAPAD national | ArcGIS query | GeoJSON | Easy |
| Park/campground list | nt.gov.au park pages | Scrape | HTML | Medium |
| Campground facilities | nt.gov.au park pages | Scrape | HTML | Medium |
| Campfire rules | nt.gov.au fire safety | Scrape | HTML | Medium |
| Seasonal closures | nt.gov.au park pages | Scrape | HTML | Medium |

## 7. Campfire Status Logic (Northern Territory)

```
IF fireBan = DECLARED for this area
  → RESTRICTED (no campfires; small cooking fires only with strict conditions)
ELSE IF fireDangerPeriod = ACTIVE
  → ALLOWED_WITH_PERMIT (permit required for burning)
ELSE
  → ALLOWED (in provided fireplaces/pits)
```

Note: NT is unique in still allowing small cooking fires during fire bans.

## 8. Challenges & Notes

- NT has the **least developed digital infrastructure** for fire/parks data
- SecureNT likely has a hidden API endpoint that could be discoverable via browser dev tools
- Fire management split between Bushfires NT and NTFRS creates complexity
- Top End and Central Australia have very different fire seasons
- Many parks close seasonally — important to communicate to users
- Relatively few managed campgrounds compared to eastern states
- Most camping in the NT involves remote, unmanaged areas
- NR Maps interactive viewer is the best spatial data source
- The cooking fire exception during fire bans is a unique NT feature
- Aboriginal land permits may be required for access to some areas
