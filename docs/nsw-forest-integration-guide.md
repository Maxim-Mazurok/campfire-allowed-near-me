# NSW Forest Integration Guide

Last updated: 2026-02-25

## Purpose

Define the preferred geospatial source for NSW state-forest lookup and boundary rendering.

## Recommendation

Use **Forestry Corporation of NSW (FCNSW) dedicated state forest geometry** as the primary source for forest location and extent.

Why this is preferred over generic geocoding:
- Polygon boundaries reflect legal surveyed extents, not approximate centroid points.
- Forest metadata comes from the authoritative source (`SFName`, `SFNo`, and related fields).
- Boundary-aware UX becomes possible (for example, inside/outside checks and proper map shading).
- It removes recurring ambiguity from place-name geocoding.

## Source of truth

- Official FCNSW Open Data portal: https://data-fcnsw.opendata.arcgis.com/
- Feature service layer (dedicated state forests):
  - `https://services2.arcgis.com/iCBB4zKDwkw2iwDD/arcgis/rest/services/NSW_Dedicated_State_Forests/FeatureServer/0`

## Query pattern

Use ArcGIS `/query` against `SFName` with fuzzy matching:
- `where`: `UPPER(SFName) LIKE '%YOUR_QUERY%'`
- `returnGeometry`: `true`
- `outFields`: `*` (or explicit subset)
- `f`: `json` or `geojson`
- `outSR`: `4326` (preferred output for web map lat/lon)

Example endpoint:
- `https://services2.arcgis.com/iCBB4zKDwkw2iwDD/arcgis/rest/services/NSW_Dedicated_State_Forests/FeatureServer/0/query`

## Coordinate reference system

- Source geometry is commonly delivered in Web Mercator (`EPSG:3857`).
- Prefer server-side conversion by requesting `outSR=4326`.
- Client-side CRS conversion should only be used as a fallback.

## Name matching guidance

- `SFName` values are usually uppercase.
- Names may omit the phrase "State Forest".
- Keep fuzzy matching for common variants and spelling differences.

## Repository policy

- FCNSW ArcGIS geometry is the preferred geospatial source.
- Google Geocoding and Nominatim are fallback-only for unresolved or missing FCNSW matches.
- Any new geocoding/ranking logic must preserve FCNSW-first behavior.

## Implementation status

All items below are implemented:

1. **FCNSW ArcGIS query** — `ForestGeocoder.lookupFcnswArcgis()` queries the Feature Server by `SFName` with `LIKE` matching and `outSR=4326`.
2. **Polygon centroid** — `computePolygonCentroid()` derives the signed-area centroid of the exterior ring returned by ArcGIS.
3. **Canonical identifiers** — display name includes `SFName` and `SFNo` (e.g. "BELANGLO State Forest (SF123)").
4. **Provider cascade** — FCNSW is attempted first; Google Geocoding and Nominatim are fallback-only.
5. **Diagnostics tracking** — provider field records `FCNSW_ARCGIS`, `GOOGLE_GEOCODING`, or `OSM_NOMINATIM`.
6. **Disambiguation** — when multiple forests match a LIKE query, exact `SFName` match is preferred; otherwise the lookup is marked ambiguous and falls through.
7. **Directory name variant** — if the fire-ban name differs from the facility directory name, both variants are tried against FCNSW before falling back.
