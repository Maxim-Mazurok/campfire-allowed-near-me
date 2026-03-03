# 1. Use Static Snapshot Pipeline Instead of Live API

Date: 2025-01-01

## Status

Accepted

## Context

The primary data sources (Forestry Corporation NSW, FCNSW closures) are protected by Cloudflare and AWS IP blocks, requiring a residential proxy and headless browser to scrape. Making these requests on every user visit would be slow, expensive, and unreliable.

## Decision

Use a scheduled pipeline (GitHub Actions, twice daily) that scrapes, parses, geocodes, enriches, and assembles all data into a single static JSON snapshot committed to the repository and served as a static asset from Cloudflare Pages.

## Consequences

- Frontend loads instantly from a static file with no backend API dependency for forest data.
- Data freshness is limited to the pipeline schedule (every 12 hours).
- Pipeline failures are isolated from the user experience — stale but valid data is still served.
- Proxy costs are fixed and predictable (2 runs/day).
