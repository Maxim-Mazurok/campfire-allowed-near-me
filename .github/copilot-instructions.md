# Copilot Instructions

- Use TypeScript for new code in both API and web app.
- Campfire legality must come from Forestry NSW `Solid Fuel Fire Ban` data.
- Do not use Firewood collection column for ban status logic.
- Keep geocoding cache persistent with SQLite in `data/cache/coordinates.sqlite`.
- Maintain tests for parser, API route behavior, and UI happy/fallback paths.
- Run `npm run typecheck` and `npm test` before proposing merges.
