# 2. Use Cloudflare Workers for Driving Route Proxy

Date: 2025-01-01

## Status

Accepted

## Context

The Google Routes API requires a server-side API key that must not be exposed to the browser. We need a thin proxy layer that also provides caching to minimize API costs. The application is hosted on Cloudflare Pages.

## Decision

Deploy a Cloudflare Worker (`routes-proxy`) that accepts route requests from the frontend, caches results in Workers KV (bucketed by origin grid cell, 7-day TTL), and forwards uncached requests to Google Routes ComputeRouteMatrix API.

## Consequences

- API key stays server-side in Worker environment secrets.
- KV caching reduces Google API costs by serving repeated/nearby queries from cache.
- Edge deployment keeps latency low for Australian users.
- Requires Cloudflare Pages Function as a service-binding bridge.
