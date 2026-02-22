# Copilot Instructions

- Use TypeScript for new code in both API and web app.
- Campfire legality must come from Forestry NSW `Solid Fuel Fire Ban` data.
- Do not use Firewood collection column for ban status logic.
- Keep geocoding cache persistent with SQLite in `data/cache/coordinates.sqlite`.
- Maintain tests for parser, API route behavior, and UI happy/fallback paths.
- Run `npm run typecheck` and `npm test` before proposing merges.

## Maintainability and modularity

- Do not keep growing oversized files.
	- Soft file-size target: <= 300 lines.
	- Hard file-size cap: 500 lines for touched files.
	- If a touched file exceeds 500 lines, include extraction/refactor work in the same change (selectors/hooks/components/services).
- Avoid combining networking, domain logic, and rendering in one React component.
- Prefer pure selectors/helpers for filtering/sorting/warning derivations.

## Shared contracts (API + WebSocket)

- API response and websocket payload types must be defined in one shared location and consumed by both API and web.
- Do not duplicate DTO or websocket message type definitions across backend and frontend.
- For websocket UI integration, prefer reusable typed hooks over ad-hoc per-component websocket effects.
