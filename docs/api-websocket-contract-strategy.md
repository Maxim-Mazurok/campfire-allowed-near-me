# API + WebSocket Contract Strategy (REST now, tRPC-ready)

Last updated: 2026-02-22

## What was implemented

- Shared contract source in `packages/shared/src/contracts.ts`.
- Shared websocket message contracts in `packages/shared/src/websocket.ts`.
- API websocket publish path emits typed payloads from shared message contracts.
- Websocket client uses a reusable typed reconnecting hook (`use-reconnecting-websocket.ts`).
- Frontend API types consume shared contracts (no duplicated DTO definitions).

This is considered complete. tRPC remains an optional future evaluation (see below).

## Why this is pragmatic now

- Keeps current REST + websocket architecture stable.
- Removes a major class of FE/BE drift bugs.
- Enables faster feature iteration without full protocol migration.

## tRPC evaluation

### Benefits
- End-to-end typed procedures and inputs.
- Reduced manual endpoint type wiring.
- Better developer ergonomics for app-scale growth.

### Tradeoffs for this repo today
- Requires changing API shape and client data-fetching conventions.
- Current websocket progress model would still need dedicated handling or additional transport work.
- Migration cost is non-trivial during active experimentation.

## Recommendation

- Keep REST + shared contracts now (already implemented).
- Add tRPC as an **incremental pilot** for one new capability (for example, upcoming source diagnostics endpoint), not a full rewrite.
- Re-evaluate full migration after:
  1. shared contracts are stable,
  2. App decomposition progresses,
  3. source-connector architecture lands.

## Suggested pilot plan

1. Introduce tRPC server alongside existing routes.
2. Build one non-critical typed endpoint via tRPC.
3. Compare DX and maintenance overhead for 2-3 sprints.
4. Decide whether to expand or keep hybrid model.
