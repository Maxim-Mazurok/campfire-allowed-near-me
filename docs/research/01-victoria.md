# Victoria (VIC) — Data Source Research Report

## Overview

Victoria has two fire authorities: **CFA (Country Fire Authority)** for rural/regional areas and **FRV (Fire Rescue Victoria)** for metro Melbourne. Forest management is handled by **DEECA (Department of Energy, Environment and Climate Action)** via **Forest Fire Management Victoria (FFMVic)**. Parks are managed by **Parks Victoria**.

Victoria has **9 fire weather districts**: Mallee, Wimmera, South West, Northern Country, North Central, Central, North East, East Gippsland, West and South Gippsland.

---

## 1. Total Fire Bans & Fire Danger Ratings

### CFA RSS Feeds (Primary)
- **All of Victoria**: `https://www.cfa.vic.gov.au/cfa/rssfeed/tfbfdrforecast_rss.xml`
- **Per-district feeds** available for each of the 9 fire districts
- Format: RSS 2.0 (XML), updates every minute
- Data: Total Fire Ban status (yes/no), Fire Danger Rating per district, 4-day forecast
- License: Creative Commons Attribution 4.0
- Source portal: `https://discover.data.vic.gov.au/dataset/cfa-data-feeds-for-incidents-total-fire-bans-fire-danger-ratings-and-latest-news`

### VicEmergency / data.emergency.vic.gov.au
- VicEmergency aggregates fire ban data from CFA
- ArcGIS Online service synced from `data.emergency.vic.gov.au` exists on Esri Australia Hub
- Bushfires Hub layer: "Fire Danger Ratings - 4 Day Forecast (VIC)"

### TFB District Boundaries (Geometry)
- **Vicmap Admin — CFA Total Fire Ban District Polygon**
- Source: `https://discover.data.vic.gov.au/dataset/vicmap-admin-country-fire-authority-cfa-total-fire-ban-district-polygon`
- Formats: SHP, GDB, WMS, WFS, TAB, MIF, DWG, DXF
- License: CC BY 4.0
- WFS endpoint can serve GeoJSON on demand

### BOM Fire Danger Ratings
- `https://www.bom.gov.au/vic/forecasts/fire-danger-ratings.shtml`
- HTML table with 4-day forecast per district
- Parseable but CFA RSS is a better machine-readable source

---

## 2. Forest/Park Locations & Boundaries

### Forest Management Area Boundaries
- **DataVic**: `https://discover.data.vic.gov.au/dataset/forest-management-area-boundaries`
- Formats: SHP, GDB, TAB, MIF, DWG, DXF
- Organisation: DEECA
- License: CC BY 4.0
- Contains polygon boundaries for all forest management areas

### State Forest Boundaries
- Available via **MapShareVic** (Vicmap spatial data services)
- WMS/WFS services at `https://services.land.vic.gov.au/`
- Crown Land Status layer includes state forest designations

### National Parks
- Parks Victoria manages 45+ national parks, 27 state parks, 13 marine parks
- Park boundaries available via Vicmap datasets on DataVic

### CAPAD (National)
- The national CAPAD ArcGIS FeatureServer covers all VIC protected areas too

---

## 3. Camping & Facilities Data

### Parks Victoria
- **Website**: `https://www.parks.vic.gov.au/where-to-stay`
- Booking system: `https://bookings.parks.vic.gov.au`
- No public API discovered — data would need to be **scraped from park pages**
- Each park page lists: camping types, facilities (toilets, showers, BBQs, fireplaces), accessibility
- Parks are searchable by region and activity

### Explore Outdoors Victoria
- `https://www.exploreoutdoors.vic.gov.au/`
- Provides camping guidance for state forests
- States: "Campfires are allowed in state forests except on Total Fire Ban days"
- Key difference from NSW: VIC state forests generally allow campfires unless there's a TFB

### Recreation Sites Dataset (DataVic)
- Previously existed at `https://discover.data.vic.gov.au/dataset/recreation-sites`
- Currently returning 404 — may have been retired or moved
- If restored, would contain campground point data

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in Victoria

Victoria's campfire system is **fundamentally different** from NSW:

1. **Total Fire Ban days** → All campfires banned everywhere (CFA declares)
2. **Fire Danger Period** (seasonal, varies by municipality) → Campfires restricted to:
   - Fireplaces provided in parks/campgrounds
   - 3m clearance required
   - Must be attended at all times
3. **Outside Fire Danger Period** → Campfires allowed with general safety rules

### FFMVic Fire Restriction Dates
- `https://www.ffm.vic.gov.au/permits-and-regulations/fire-restriction-dates`
- Shows start/end dates of seasonal prohibited periods
- Per-municipality dates
- FFMVic declares restrictions for land within 1.5km of public land
- Would need to be **scraped** — no API discovered

### Key Distinction
- Victoria does NOT have a "Solid Fuel Fire Ban" per-forest system like NSW's Forestry Corp
- Instead, campfires are allowed in state forests year-round **except during Total Fire Ban days** and the Fire Danger Period
- Parks Victoria campgrounds have their own rules per park

---

## 5. Closures

### Parks Victoria Closures
- Park closure information on: `https://www.parks.vic.gov.au`
- PDF maps generated periodically showing closures: "National Park and State Forest Closures"
- No structured API — would need to **scrape park alert pages** or parse PDFs

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Total fire ban status | CFA RSS feed | `fetch()` | XML/RSS | Easy |
| TFB district geometry | DataVic WFS | `fetch()` | GeoJSON | Easy |
| Fire danger ratings | CFA RSS or BOM | `fetch()` | XML | Easy |
| Fire restriction dates | FFMVic website | Scrape | HTML | Medium |
| Forest boundaries | DataVic/CAPAD | Bulk download or WFS | SHP/GeoJSON | Easy |
| Park/campground list | Parks Victoria | Scrape | HTML | Medium-Hard |
| Facilities per park | Parks Victoria | Scrape | HTML | Medium-Hard |
| Campfire rules per park | Parks Victoria + FFMVic | Scrape + rules engine | HTML + logic | Hard |
| Park closures | Parks Victoria alerts | Scrape | HTML | Medium |

## 7. Campfire Status Logic (Victoria)

```
IF totalFireBan = DECLARED for this district
  → BANNED (statewide TFB takes precedence)
ELSE IF fireDangerPeriod = ACTIVE for this municipality
  → RESTRICTED (only in designated fireplaces with permit conditions)
ELSE
  → ALLOWED (general safety rules apply)
```

## 8. Challenges & Notes

- Victoria has **no equivalent** of NSW Forestry Corp's "Solid Fuel Fire Ban" page — the ban logic is simpler (TFB + Fire Danger Period)
- Parks Victoria does not expose a public API for campground data
- Fire Danger Period start/end dates vary by municipality and change each season
- The CFA RSS feeds are the cleanest data source in VIC
- State forest campfire policy is permissive by default ("allowed unless banned")
