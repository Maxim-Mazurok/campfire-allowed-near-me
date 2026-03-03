# 3. Use FCNSW ArcGIS as Primary Geocoding Source

Date: 2025-01-01

## Status

Accepted

## Context

Forest geocoding (converting forest names to coordinates) needs to produce centroid coordinates that land inside the actual forest boundaries. Generic geocoding services (Google, Nominatim) sometimes return coordinates for nearby towns or the wrong region.

## Decision

Use the FCNSW ArcGIS Feature Server as the primary geocoding source. It provides official Dedicated State Forest polygon geometries — we query by forest name, compute the polygon centroid, and use that as the coordinate. Google Geocoding and OSM Nominatim are used as sequential fallbacks.

## Consequences

- Coordinates are authoritative and land inside official forest boundaries.
- Reduces dependency on paid Google Geocoding API calls.
- ArcGIS queries are free and unrestricted.
- Requires SQLite cache to avoid re-querying across pipeline runs.
