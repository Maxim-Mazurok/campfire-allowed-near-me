# AGENTS

## Purpose
This file gives baseline instructions for AI coding agents collaborating in this repository.

## Project rules
- Keep backend and frontend in TypeScript.
- Preserve the primary user goal: find the closest NSW forest where campfires are legal now.
- Treat Forestry NSW `Solid Fuel Fire Ban` as the source of truth for burn legality.
- Ignore firewood collection status for ban logic.

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
- Frontend/backend contracts must be shared from a single source (types and websocket payloads).
	- Avoid duplicating DTOs in API and web folders.
- For websocket integrations, use typed message contracts and a reusable reconnecting hook pattern.
- Prefer behavior-preserving refactors before adding new feature code in oversized files.

## Data and caching
- Coordinate cache is SQLite-backed (`data/cache/coordinates.sqlite`).
- Do not commit runtime cache DB files.
- When status parsing changes, avoid reusing stale snapshots with unknown status values.
- Never auto-delete or auto-recreate the local `campfire-nominatim` Docker container during normal dev flows.
	- Preserve existing container data and start the existing container if it is stopped.
	- Recreate only when explicitly requested by the user in the current session.

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
