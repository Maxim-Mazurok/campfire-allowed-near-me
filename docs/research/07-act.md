# Australian Capital Territory (ACT) — Data Source Research Report

## Overview

The ACT is Australia's **smallest self-governing territory** (2,358 km²). Parks are managed by **ACT Parks and Conservation Service** (PCS), under the Environment, Planning and Sustainable Development Directorate. Fire bans are managed by the **ACT Emergency Services Agency (ESA)**, which includes ACT Rural Fire Service (ACTRFS) and ACT Fire & Rescue.

The ACT has very limited campfire locations — only **4 designated areas**:
1. Namadgi National Park
2. Tidbinbilla Nature Reserve
3. Cotter Campground
4. Uriarra Crossing

---

## 1. Total Fire Bans & Fire Danger Ratings

### ACT ESA — Total Fire Bans
- **Website**: `https://esa.act.gov.au/be-emergency-ready/total-fire-bans`
- Total Fire Ban icon displayed on ESA homepage next to daily Fire Danger Rating
- TFB applies to the **entire ACT** (no sub-districts — the territory is too small)
- During TFB: offence to light, maintain, or use fire in the open air
- ESA publishes TFB declarations as news items

### BOM Fire Danger Ratings
- ACT is combined with NSW: `https://www.bom.gov.au/act/forecasts/fire-danger-ratings.shtml`
- ACT has its own fire weather district within the NSW/ACT combined page

### ACT Fire Season
- Bush Fire Season typically 1 October – 31 March
- During this period: permits required for fires in the open
- Outside this period: campfires allowed at designated locations

### Data Access
- ESA does not appear to have a structured API or data feed
- **Simplest approach**: scrape the ESA homepage for TFB status indicator
- Since the entire ACT is one zone, this is trivially binary: TFB declared or not

---

## 2. Park Locations & Boundaries

### ACT Government Open Data
- `https://www.data.act.gov.au/`
- ACTmapi (ACT's spatial data portal) has reserve boundaries
- Given only ~4 campfire locations, manual coordinate entry is feasible

### Parks
Only a handful of parks are relevant:
- **Namadgi National Park** (106,000 ha — 46% of the ACT)
- **Tidbinbilla Nature Reserve**
- **Cotter Reserve / Cotter Campground**
- **Uriarra Crossing**
- **Murrumbidgee River Corridor**

### CAPAD (National)
- ACT protected areas included in national dataset

---

## 3. Camping & Facilities Data

### ACT Parks Camping
- `https://www.act.gov.au/environment/land/bushfire-management` — fire management info
- Very limited camping infrastructure:
  - **Namadgi NP**: Several bush camping areas + Woods Reserve campground
  - **Tidbinbilla**: Day-use mostly, limited camping
  - **Cotter Campground**: Popular campground with facilities
  - **Uriarra Crossing**: Basic camping

### Facilities
- Given only 4-5 campfire locations, facilities can be **manually catalogued**
- No need for automated scraping — a static dataset is sufficient

---

## 4. Campfire/Fire Restrictions

### How Campfire Rules Work in the ACT

The simplest system in Australia:

1. **Total Fire Ban** (ESA) → No fires anywhere in the ACT
2. **Bush Fire Season** (Oct–Mar) → Campfires only in designated fireplaces with permit conditions
3. **Outside Bush Fire Season** → Campfires allowed at designated locations in provided fire pits
4. **Only 4 locations ever allow campfires** → Everything else is always "no campfires"

### ACT Parks Campfire Rules
- `https://www.act.gov.au/environment/land/bushfire-management/total-fire-ban`
- General info on TFB restrictions in parks and reserves

---

## 5. Closures

### Park Closures
- Published on the ACT Parks website
- Seasonal closures for fire danger
- Given the small number of parks, simple to monitor

---

## 6. Data Acquisition Strategy

| Data | Source | Method | Format | Difficulty |
|---|---|---|---|---|
| Total fire ban status | ESA homepage | Scrape (TFB icon) | HTML | **Very Easy** |
| Fire danger ratings | BOM (NSW/ACT page) | Already have this | HTML/XML | **Already done** |
| Park boundaries | ACTmapi / CAPAD | Download | GeoJSON | Easy |
| Campground list | Manual | Static data | JSON | **Trivial** |
| Facilities | Manual | Static data | JSON | **Trivial** |
| Campfire rules | Manual | Static data | JSON | **Trivial** |
| Closures | ACT Parks website | Scrape | HTML | Easy |

## 7. Campfire Status Logic (ACT)

```
IF totalFireBan = DECLARED (territory-wide)
  → BANNED
ELSE IF bushFireSeason = ACTIVE AND NOT at designated fireplace
  → BANNED
ELSE IF location IN [Namadgi, Tidbinbilla, Cotter, Uriarra]
  → ALLOWED (in designated fire pits only)
ELSE
  → NOT_ALLOWED (campfires not permitted at this location)
```

## 8. Challenges & Notes

- ACT is the **easiest state/territory to implement** — only 4 campfire locations
- Campground data can be hardcoded/static — no scraping needed for facilities
- TFB is territory-wide binary (yes/no) — single scrape of ESA homepage
- ACT shares the BOM fire danger page with NSW — already partially covered
- The ACT's compact size means the entire territory is in one fire weather district
- Consider implementing ACT as a **proof of concept** for the multi-state expansion
- The ACT RFS is part of the broader ESA, not a separate organization like NSW RFS
- Very few users will search for campfires specifically in the ACT (mostly Canberrans going to Namadgi)
