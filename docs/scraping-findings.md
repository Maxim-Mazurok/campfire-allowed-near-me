# Scraping Validation Findings

> Completed: 2026-02-24. This document records the full investigation into scraping all five data sources from GitHub Actions runners.

---

## Summary

All five data sources are successfully scrapeable from GitHub Actions using a combination of three techniques:

| Target | Domain | Blocking Mechanism | Working Method | Bandwidth |
|---|---|---|---|---|
| Forestry fire bans | forestrycorporation.com.au | Cloudflare JS challenge | Playwright + stealth + residential proxy (headed) | ~79 KB |
| Forestry forests directory | forestrycorporation.com.au | Cloudflare JS challenge | Playwright + stealth + residential proxy (headed) | ~485 KB |
| Forest closures | forestclosure.fcnsw.net/indexframe | AWS API Gateway IP block | `fetch()` through residential proxy | ~990 KB |
| RFS fire danger ratings | rfs.nsw.gov.au | None | Plain `fetch()` | ~6 KB |
| RFS fire danger GeoJSON | rfs.nsw.gov.au | None | Plain `fetch()` | ~1.6 MB |

---

## Blocking Mechanisms Discovered

### Forestry Corporation (`forestrycorporation.com.au`) — Cloudflare JS Challenge

Both pages (`/visit/solid-fuel-fire-bans` and `/visiting/forests`) are behind Cloudflare with an active JavaScript challenge (Turnstile). Key observations:

- **Plain `fetch()`** from any IP returns HTTP 403 with a 9 KB "Just a moment..." page containing `<noscript>Enable JavaScript and cookies to continue</noscript>`.
- **Headless Playwright** from GHA datacenter IPs also gets 403.
- **Headed Playwright + stealth plugin** from datacenter IPs: the fire-bans page passed ~2/3 of the time, the forests-directory page never passed. Cloudflare applies per-path challenge difficulty.
- **Residential proxy + `fetch()`**: still 403 — the IP change alone is insufficient because Cloudflare requires JS execution to solve the challenge.
- **Residential proxy + headed Playwright + stealth**: both pages return HTTP 200 consistently. The residential AU IP combined with a real browser engine satisfies Cloudflare's bot detection.

### Forest Closures (`forestclosure.fcnsw.net`) — AWS API Gateway IP Block

- Returns `{"message":"Forbidden"}` (23 bytes, `content-type: application/json`) to GHA datacenter IPs.
- No Cloudflare headers present. The domain is fronted by AWS API Gateway which blocks non-residential IPs at the edge.
- **Residential proxy + plain `fetch()`** returns HTTP 200 with the full 990 KB page. No browser needed — the block is purely IP-based.

### RFS (`rfs.nsw.gov.au`) — No Blocking

Both RFS endpoints serve data without any bot protection. Plain `fetch()` from GHA datacenter IPs returns HTTP 200 every time.

---

## Iteration History

### v1 — Baseline (plain fetch + Playwright headless)

- **Methods**: `plain-fetch`, `playwright-headless`
- **Result**: All three blocked targets failed with both methods from GHA datacenter IPs.

### v2 — Stealth plugin + headed mode

- **Methods**: `plain-fetch`, `playwright-headless`, `stealth-headless`, `stealth-headed`
- **Added**: `playwright-extra` + `puppeteer-extra-plugin-stealth`, `xvfb-run` for headed mode in CI.
- **Result**: `stealth-headed` bypassed Cloudflare for fire-bans (2/3 success rate) and forests-directory, but the forests-directory page was flaky. `forestclosure.fcnsw.net` still blocked by all methods — confirmed it was not Cloudflare.

### v3 — Response body and header logging

- **Added**: Full response body logging for failed requests, HTTP header inspection.
- **Result**: Confirmed `forestclosure.fcnsw.net` returns `{"message":"Forbidden"}` from AWS API Gateway (content-type `application/json`, no `server: cloudflare` header, no `cf-ray`). Not a Cloudflare issue — pure IP-based blocking.

### v4 — Residential proxy via fetch (no browser)

- **Methods**: `direct-fetch`, `proxy-fetch` (using `undici.ProxyAgent` through Decodo AU residential proxy).
- **Removed**: Playwright entirely (testing proxy hypothesis).
- **Result**: `proxy-fetch` solved `forestclosure.fcnsw.net` (HTTP 200, 990 KB). But Cloudflare targets still returned the JS challenge page — residential IP alone is insufficient when the server requires JS execution.

### v5 — Proxy + browser (separate contexts)

- **Methods**: `direct-fetch`, `proxy-fetch`, `proxy-browser` (Playwright + stealth + proxy, separate browser per target).
- **Result**: fire-bans passed (HTTP 200, 79 KB). forests-directory still got a Cloudflare Turnstile challenge (HTTP 403, 28 KB). The per-path challenge difficulty defeated the separate-context approach because each new browser context must re-solve Cloudflare independently.

### v6 — Shared browser context (final, working)

- **Methods**: `direct-fetch`, `proxy-fetch`, `proxy-browser` (shared `BrowserContext` across same-domain targets).
- **Key change**: One `chromium.launch()` + `browser.newContext()` for all `forestrycorporation.com.au` targets. The fire-bans page loads first (easier challenge), and the same context reuses any session state for the forests-directory page.
- **Result**: All 5 targets succeeded. Both Cloudflare targets returned HTTP 200 immediately — Cloudflare recognized the residential IP + headed browser as trustworthy and did not serve a Turnstile widget. No `cf_clearance` cookie was even set, meaning the challenge was bypassed entirely rather than solved.

---

## Proxy Service: Decodo (formerly Smartproxy)

### Selection Rationale

Evaluated several residential proxy providers:

| Provider | Plan | AU Coverage | Notes |
|---|---|---|---|
| IPRoyal | Pay-As-You-Go, $5.50/GB, no expiry | Yes | Simple, but more expensive per GB |
| Decodo (Smartproxy) | Pay-As-You-Go, $3.50/GB, 12-month expiry | Yes (AU endpoint) | Cheaper per GB, free 100 MB trial |
| Bright Data | Complex tiers, $10+/GB for small usage | Yes | Overkill for this use case |
| Oxylabs | Enterprise-focused, high minimums | Yes | Way too expensive |

**Chosen: Decodo** — cheapest per-GB for low-volume usage, simple API, AU residential endpoint available.

### Configuration

- **Endpoint**: `au.decodo.com:30001–30010` (Australian residential IPs, 10-port pool for retry rotation)
- **Authentication**: Username/password (stored in GitHub Secrets as `DECODO_PROXY_USERNAME` and `DECODO_PROXY_PASSWORD`)
- **Protocol**: HTTP proxy (works with both `undici.ProxyAgent` for fetch and Playwright's built-in proxy config)

### Cost Projection

- **Per-run bandwidth**: ~1.55 MB (79 KB + 485 KB + 990 KB for proxy targets)
- **Per-run cost**: ~$0.005 at $3.50/GB
- **2x/day schedule**: ~$3.65/year
- **Trial credit**: 100 MB free = ~64 runs = ~1 month of 2x/day usage
- **Pay-As-You-Go**: Pre-pay $3.50 for 1 GB = ~645 runs = ~10 months of coverage
- **Traffic expiry**: 12 months from purchase (sufficient for annual top-up)

---

## Technical Stack

### Dependencies Added

```json
{
  "playwright-extra": "^4.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2"
}
```

`undici` is built into Node.js 25 (no separate installation needed for `ProxyAgent`).

### GHA Workflow Requirements

- **Playwright install**: `npx -y playwright install --with-deps chromium`
- **Headed mode in CI**: `xvfb-run --auto-servernum --` prefix for the script command (provides a virtual X display)
- **Timeout**: 15 minutes (accounts for Playwright launch + proxy latency + Cloudflare wait times)
- **Secrets**: `DECODO_PROXY_USERNAME`, `DECODO_PROXY_PASSWORD`

### Scraping Methods

Three methods, applied per-target based on requirements:

1. **`direct-fetch`**: Plain `fetch()` with browser-like headers. Used as baseline for unprotected targets.
2. **`proxy-fetch`**: `fetch()` routed through Decodo via `undici.ProxyAgent`. Used for IP-blocked (non-Cloudflare) targets.
3. **`proxy-browser`**: Playwright (via `playwright-extra` + stealth plugin) in headed mode, with proxy configured at the `BrowserContext` level. Used for Cloudflare JS challenge targets. A single shared context is reused across same-domain targets for cookie/session continuity.

### Cloudflare Challenge Detection

Reuses existing `isCloudflareChallengeHtml()` from `pipeline/services/forestry-parser.ts`:
```typescript
// Checks for: "Just a moment" | "Performing security verification" | "Enable JavaScript and cookies"
```

---

## Key Insights for Production Pipeline

1. **Session reuse is critical**: Always use a shared `BrowserContext` for pages on the same Cloudflare-protected domain. Separate contexts trigger independent challenges (which may be harder for secondary pages).

2. **Headed mode is required**: Cloudflare's Turnstile challenge detects headless browsers even with the stealth plugin. The `headless: false` + `xvfb-run` combination is necessary in CI.

3. **Residential IP is required**: GHA datacenter IPs (Azure/Microsoft ranges) are blocked by both Cloudflare (for Forestry Corp) and AWS API Gateway (for FCNSW). A residential proxy is the only reliable bypass.

4. **Proxy is not needed for RFS**: The RFS endpoints have no bot protection. Using the proxy for these would waste bandwidth.

5. **Bandwidth is minimal**: ~1.55 MB per run through the proxy. At 2x/day, annual proxy cost is under $4.

6. **No API key rotation needed**: Decodo credentials are static username/password. No token refresh or OAuth flow to manage.
