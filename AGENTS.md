# AGENTS

## Purpose
This file gives baseline instructions for AI coding agents collaborating in this repository.

## Project rules
- Keep backend and frontend in TypeScript.
- Preserve the primary user goal: find the closest NSW forest where campfires are legal now.
- Treat Forestry NSW `Solid Fuel Fire Ban` as the source of truth for burn legality.
- Ignore firewood collection status for ban logic.
- Use **FCNSW ArcGIS dedicated-state-forest geometry** as the preferred source for forest location and boundaries. See `docs/nsw-forest-integration-guide.md`.
- Use Google Geocoding and Nominatim only as fallback when FCNSW lookup is unresolved.

## Engineering constraints
- Prefer small, testable changes.
- Update or add tests when behavior changes.
- Keep map UX resilient: avoid regressions that hide all markers.

### Pre-handoff verification
Before finishing any task that includes code changes, run **`npm test`** (which executes `npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e`) and confirm all checks pass. If a single combined run is too slow or a specific suite is irrelevant, you may run the sub-commands individually, but every sub-command must pass before handoff. Do not hand off with known test or type-check failures.

## Architecture guardrails
- Keep modules focused and small:
	- Soft limit: 300 lines per file.
	- Hard limit: 500 lines per file.
	- If a touched file is above the hard limit, include a refactor step in the same task unless explicitly blocked.
- Do not introduce or keep monolithic UI containers with business logic + rendering + networking mixed together.
	- Extract selectors, hooks, and view components into separate files.
- Prefer pure selectors/helpers for filtering/sorting/warning derivations.
- Frontend/backend contracts must be shared from a single source (types and websocket payloads).
	- Avoid duplicating DTOs in API and web folders.
- For websocket integrations, use typed message contracts and a reusable reconnecting hook pattern.
- Prefer behavior-preserving refactors before adding new feature code in oversized files.

## UI library (Mantine)
- **Read `.github/mantine-guide.md` before any UI work.** It contains the full component/hook catalogue, styling guide, anti-patterns, and project-specific setup.
- The web app uses **Mantine v8** (`@mantine/core`, `@mantine/hooks`) with `@tabler/icons-react` for icons.
- Do not use FontAwesome or tippy.js — they have been removed.
- Use Mantine components (Modal, Button, Badge, TextInput, SegmentedControl, etc.) instead of hand-rolled HTML+CSS.
- Theme is in `web/src/theme.ts`; **do not modify it without explicit user approval**.
- **Do not use custom hex/RGB/HSL color values** — always use Mantine's built-in named colors.
- Prefer semantic theme colors where the intent matches the semantics (e.g. use `color="warning"` for warning indicators, not for unrelated orange UI). Do not repurpose semantic colors for purely decorative or unrelated uses.
- For jsdom tests rendering Mantine components, use `renderWithMantine` from `tests/test-utils.tsx`.
- The vitest setup file `tests/vitest-jsdom-setup.ts` polyfills `window.matchMedia` and `ResizeObserver` for jsdom tests.
- For detailed Mantine API lookups at runtime, use `mcp_context7` with library ID `/llmstxt/mantine_dev_llms_txt`.

## Data and caching
- Coordinate cache is SQLite-backed (`data/cache/coordinates.sqlite`).
- Do not commit runtime cache DB files.
- When status parsing changes, avoid reusing stale snapshots with unknown status values.
- Never auto-delete or auto-recreate the local `campfire-nominatim` Docker container during normal dev flows.
	- Preserve existing container data and start the existing container if it is stopped.
	- Recreate only when explicitly requested by the user in the current session.

### Geocoding cache versioning
- The GitHub Actions workflow (`update-forest-data.yml`) uses a versioned cache key for geocoding results (e.g. `geocoding-cache-<os>-v4-<run>`).
- **Whenever geocoding logic changes** (new provider, changed priority, different centroid algorithm, modified query patterns, etc.), **bump the version number** in the cache key (e.g. `v4` → `v5`) so CI discards stale cached coordinates and rebuilds from scratch.
- Also clear the local cache (`rm -f data/cache/coordinates.sqlite`) and regenerate the snapshot locally to verify the new geocoding behavior.

## Scraping and proxy
- Production scraping uses three methods depending on target (see `docs/scraping-findings.md`):
	- Forestry Corp (Cloudflare): `playwright-extra` + stealth + self-hosted tinyproxy via Tailscale + headed mode.
	- FCNSW closures (AWS API Gateway): `fetch()` + tinyproxy via `undici.ProxyAgent`.
	- RFS (public): plain `fetch()`, no proxy needed.
- Always use a shared `BrowserContext` for multiple pages on the same Cloudflare-protected domain.
- Proxy runs on a personal MacBook (tinyproxy on port 8888), accessible to GHA runners via Tailscale mesh VPN. See ADR `0004-self-hosted-residential-proxy.md`.
- Proxy credentials are in GitHub Secrets (`PROXY_USERNAME`, `PROXY_PASSWORD`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `TAILSCALE_PROXY_IP`). Never hardcode them.
- Do not route RFS requests through the proxy — it wastes bandwidth unnecessarily.

## Documentation
- Keep README quick starts current for users and developers.
- Mention any required external setup (for example `npx playwright install chromium`).

## C4 architecture diagrams
- The C4 model (Structurizr DSL) lives in `docs/architecture/workspace.dsl` with helper scripts, documentation, and ADRs alongside it. See `docs/architecture/README.md` for usage.
- **Validate before handoff**: after any task that adds, removes, or renames containers, components, external systems, or relationships, run `./docs/architecture/validate.sh` (requires Docker). It checks both DSL syntax and Structurizr inspection rules (zero errors, zero warnings).
- **Keep diagrams fresh**: when a bigger task changes the architecture (new container, new external dependency, renamed pipeline stage, changed data flow, etc.), update `workspace.dsl` and re-validate as part of the same task. Do not defer diagram updates to a separate follow-up.
- **Inspect, don't just validate**: the `validate.sh` script runs both `structurizr validate` (syntax) and `structurizr inspect -severity error,warning` (architecture rules). Every relationship must have a technology string; every software system with containers must have `!docs` and `!adrs`.
- **Interactive review**: run `./docs/architecture/render.sh` to launch Structurizr Lite at `http://localhost:8080` for visual inspection. Stop with `docker stop structurizr-lite`.
- **ADRs**: significant architecture decisions are recorded in `docs/architecture/decisions/` using adr-tools format. When a user or AI agent makes a notable decision (new external system, changed deployment topology, altered data flow, new scraping strategy, caching policy change, etc.), add a new ADR in that directory. ADRs can reference each other via links in the `## Status` section — the format is `<description> [<display text>](<filename>.md)` on its own line (e.g. `Supersedes [1. Old Decision](0001-old-decision.md)`). Structurizr renders these as a navigable decision graph.

## Future AI instructions
- Treat completed roadmap phases as ongoing standards, not tasks to reopen.
- Convert one-off implementation plans into durable guidance in `docs/` after completion.
- Keep `docs/ai-implementation-handoff.md` aligned with current architecture and performance behavior.
- When performance-related code changes land, document:
	- what changed,
	- why it improves maintainability/performance,
	- how it was validated (`npm run typecheck`, `npm test`).
- Prefer adding concise operational guidance over long historical phase logs.
