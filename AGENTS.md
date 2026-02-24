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
- Run `npm run typecheck` and `npm test` before finalizing.
- Keep map UX resilient: avoid regressions that hide all markers.

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
- Theme is in `apps/web/src/theme.ts`; **do not modify it without explicit user approval**.
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

## Scraping and proxy
- Production scraping uses three methods depending on target (see `docs/scraping-findings.md`):
	- Forestry Corp (Cloudflare): `playwright-extra` + stealth + Decodo AU residential proxy + headed mode.
	- FCNSW closures (AWS API Gateway): `fetch()` + Decodo proxy via `undici.ProxyAgent`.
	- RFS (public): plain `fetch()`, no proxy needed.
- Always use a shared `BrowserContext` for multiple pages on the same Cloudflare-protected domain.
- Proxy credentials are in GitHub Secrets (`DECODO_PROXY_USERNAME`, `DECODO_PROXY_PASSWORD`). Never hardcode them.
- Do not route RFS requests through the proxy — it wastes bandwidth unnecessarily.
- The scrape-test workflow (`.github/workflows/scrape-test.yml`) is the validation tool. Run it after any scraping changes.

## Documentation
- Keep README quick starts current for users and developers.
- Mention any required external setup (for example `npx playwright install chromium`).

## Future AI instructions
- Treat completed roadmap phases as ongoing standards, not tasks to reopen.
- Convert one-off implementation plans into durable guidance in `docs/` after completion.
- Keep `docs/ai-implementation-handoff.md` aligned with current architecture and performance behavior.
- When performance-related code changes land, document:
	- what changed,
	- why it improves maintainability/performance,
	- how it was validated (`npm run typecheck`, `npm test`).
- Prefer adding concise operational guidance over long historical phase logs.
