# Specification

## Multi-area forests

A single state forest can belong to multiple FCNSW management areas on the Solid Fuel Fire Ban page. Each area may have a different solid fuel fire ban status.

### Example: Bago State Forest

| Area | Solid Fuel Fire Ban |
|---|---|
| Pine forests around Tumut, Batlow and Tumbarumba (note this also includes selected native forests) | Banned |
| Native forest areas in Bago and Bondo State Forests, including Paddy River Dam and Paling Yards camping areas | Banned |

### Deduplication rules

1. **One card per forest** — when a forest appears in multiple areas, it must NOT produce duplicate cards in the list or duplicate markers on the map.
2. **All areas visible** — the forest card must display every area the forest belongs to, each linking to the respective area page.
3. **Pessimistic ban status** — the overall solid fuel ban status is the most restrictive across all areas:
   - If the forest is **banned in at least one area**, the badge shows "banned".
   - Only if the forest is **not banned in every area** does the badge show "not banned".
   - If any area is "unknown", treat it as lower priority than both banned and not-banned.
4. **Per-area ban status** — each area entry in the card can show its own ban status (e.g., via the solid fuel badge link highlighting the correct row).
5. **Area hover highlighting** — hovering over any area name on a multi-area forest card highlights all forests in that same area on the map (same behavior as single-area forests).

### Data contract

The `ForestPoint` type carries an `areas` array as the single source of truth for area and ban information:

```typescript
interface ForestAreaReference {
  areaName: string;
  areaUrl: string;
  banStatus: BanStatus;
  banStatusText: string;
}

interface ForestPoint {
  // All areas this forest belongs to — single source for area name, URL, and ban status
  areas: ForestAreaReference[];
  // ...other fields (id, forestName, totalFireBanStatus, latitude, longitude, etc.)
}
```

Consumers derive area-level and ban-level properties via shared helpers:
- `getForestBanStatus(areas)` — pessimistic ban status (BANNED > UNKNOWN > NOT_BANNED).
- `getForestBanStatusText(areas)` — text label from the most restrictive area.
- `getForestPrimaryAreaName(areas)` — first area's name (for navigation, sorting).
- `getForestPrimaryAreaUrl(areas)` — first area's URL.

### Merge strategy (backend)

After building all per-area forest points (including geocoding, facilities, closures, etc.), a merge step groups points by normalized forest name and:

- Combines the `areas` arrays from all duplicates.
- Keeps geocode, facilities, closures, and total fire ban data from the entry with the best geocode confidence (preferring non-null coordinates).
- Generates an `id` based solely on the forest name (no area slug) to ensure uniqueness.
