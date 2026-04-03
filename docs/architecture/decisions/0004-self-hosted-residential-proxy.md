# 4. Replace Decodo with Self-Hosted Residential Proxy via Tailscale

Date: 2026-04-03

## Status

Accepted

## Context

The scraping pipeline requires an Australian residential IP to bypass two blocking mechanisms:

1. **Forestry Corporation (`forestrycorporation.com.au`)** — Cloudflare JS challenge rejects datacenter IPs even with a real browser and stealth plugin. A residential IP combined with headed Playwright + stealth is the only working method.
2. **FCNSW closures (`forestclosure.fcnsw.net`)** — AWS API Gateway blocks non-residential IPs at the edge. A residential IP with plain `fetch()` is sufficient.

We were using Decodo (formerly Smartproxy) as the residential proxy provider. While cheap (~$3.65/year at 2x/day), it introduces:

- A paid third-party dependency for a hobby project.
- Credential management (username/password in GitHub Secrets).
- 12-month traffic expiry on pre-paid bandwidth.
- Port rotation logic across a 10-port pool to work around per-port rate limits.

An always-on MacBook with an Australian residential ISP connection is already available. The missing piece is network reachability — the MacBook has no public IP (behind NAT/CGNAT).

## Decision

Replace Decodo with a self-hosted forward proxy on the MacBook, exposed to GitHub Actions runners via Tailscale (WireGuard mesh VPN).

### Architecture

```
GitHub Actions Runner
    │
    │ (Tailscale WireGuard tunnel)
    │
    ▼
MacBook (Tailscale IP 100.x.y.z)
    │
    │ tinyproxy :8888
    │
    ▼
Target websites see Australian residential IP
```

### Components

1. **tinyproxy** on the MacBook — lightweight HTTP forward proxy supporting CONNECT (for HTTPS). Listens on `0.0.0.0:8888` with IP-based ACLs restricting to Tailscale CGNAT range (`100.64.0.0/10`) and localhost. BasicAuth is enabled as defense-in-depth. `Via` header is disabled for stealth. Managed as a macOS LaunchAgent (`com.tinyproxy`) for auto-start on login with `KeepAlive`.

2. **Tailscale** on both ends — the MacBook is already enrolled. The GHA runner joins the same tailnet using the official `tailscale/github-action@v4` with an OAuth client credential (`auth_keys` scope, `tag:ci`). Ephemeral keys are used so nodes auto-expire after the run.

3. **Tailscale ACLs** — restrict access so only `tag:ci`-tagged nodes can reach the MacBook's Tailscale IP on TCP port 8888. No other traffic is permitted from CI nodes. Members retain full access to all resources.

### Security layers

1. **Tailscale authentication** — only authenticated tailnet members/tagged nodes can establish a connection.
2. **Tailscale ACLs** — `tag:ci` is restricted to TCP port 8888 on the MacBook only.
3. **tinyproxy IP ACL** — only Tailscale CGNAT range and localhost are allowed.
4. **tinyproxy BasicAuth** — username/password required even after passing network-level checks.

### What changes in the codebase

- `pipeline-config.ts`: `PROXY_HOST` default changed from `au.decodo.com` to empty (env-driven via `TAILSCALE_PROXY_IP` secret). `PROXY_PORTS` default changed from 10 Decodo ports to `"8888"`.
- Retry logic is preserved — retries on the same port for transient network failures.
- GitHub Secrets: `DECODO_PROXY_USERNAME`/`DECODO_PROXY_PASSWORD` replaced by `PROXY_USERNAME`/`PROXY_PASSWORD` (tinyproxy BasicAuth), `TS_OAUTH_CLIENT_ID`/`TS_OAUTH_SECRET` (Tailscale OAuth), and `TAILSCALE_PROXY_IP` (MacBook's Tailscale IP).
- GHA workflow adds a Tailscale connection step and a proxy reachability verification step before the generate-snapshot stage.

### What does NOT change

- Playwright + stealth + headed mode for Cloudflare targets.
- `undici.ProxyAgent` for fetch-based proxy requests.
- RFS scraping (no proxy, unchanged).
- Resource allowlist filtering in Playwright.
- Overall pipeline structure and data flow.

## Consequences

### Benefits

- **Zero ongoing cost** — eliminates the ~$3.65/year proxy fee and removes a paid dependency.
- **Simpler credential model** — Tailscale OAuth replaces proxy username/password. No traffic quotas or expiry.
- **No port rotation complexity** — single stable endpoint instead of 10-port pool with shuffle logic.
- **Full control** — no reliance on a third-party proxy provider's uptime or IP pool quality.
- **Same residential IP quality** — the MacBook's ISP connection is a genuine Australian residential IP, which is exactly what the target sites check for.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| MacBook offline (sleep, reboot, power loss) | Sleep disabled via energy settings; Tailscale and tinyproxy auto-start on login; GHA run simply fails and retries on next cron (same failure mode as any proxy outage) |
| ISP outage | Same failure mode as above — pipeline retries on next scheduled run |
| ISP IP changes | Irrelevant — tinyproxy forwards through whatever IP the MacBook currently has; Tailscale reconnects automatically after IP changes |
| GHA ephemeral node churn in Tailscale | Ephemeral keys auto-expire; Tailscale free tier allows up to 100 devices |
| Tailscale free tier limits | Free for personal use, up to 100 devices and 3 users — well within our needs |

### Why tinyproxy instead of Tailscale exit node?

Tailscale's exit node feature can route all traffic from the GHA runner through the MacBook, eliminating the need for a forward proxy daemon. However, this was rejected because:

- A typical GHA run downloads 200+ MB (Playwright browser, npm packages, apt dependencies, GitHub API calls). Routing all of that through the MacBook's home upload link would significantly slow down the pipeline.
- Only ~2 MB of scrape traffic per run actually needs the residential IP.
- The existing codebase already has proxy support via `undici.ProxyAgent` and Playwright's `proxy` config — swapping the endpoint URL is trivial.

With tinyproxy, only the targeted scrape requests exit through the home connection. Everything else (package installs, browser downloads, API calls) uses the GHA runner's fast datacenter network directly.

### Exit node is NOT required

Tailscale's exit node checkbox on the MacBook should remain **unchecked**. The GHA runner only needs to reach tinyproxy on port 8888 — its own internet traffic uses normal networking. The proxy is invoked explicitly via `ProxyAgent` or Playwright's proxy config.
