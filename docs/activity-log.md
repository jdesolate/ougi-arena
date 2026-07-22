# Activity Log

Append one entry per session: what was done, what's next, any open issues. This is the memory between sessions — see `CLAUDE.md` for the workflow.

## S1 — Project setup + scaffold (2026-07-23)

- `git init`; added project `CLAUDE.md` (workflow + model policy + stack) and this log.
- pnpm monorepo: `packages/shared`, `packages/server`, `packages/client`, TS strict base config, ESLint flat config.
- `shared`: placeholder export, typechecks clean.
- `server`: Colyseus (`@colyseus/core` + `@colyseus/ws-transport`) with a placeholder `ArenaRoom`; boots and listens on `ws://localhost:2567`. Needed `experimentalDecorators`/`useDefineForClassFields: false` in its tsconfig for `@colyseus/schema` decorators to typecheck.
- `client`: Vite + Phaser 3; boots to a blank scene with "Ougi Arena" text, verified in-browser with no console errors.
- `pnpm typecheck` and `pnpm lint` pass across all packages.
- **Next:** S2 — full shared sim (fixed-timestep step function, collisions, destructible obstacles, map data, unit tests). Model: Opus.
- **Open issues:** none.

## S2 — Full shared sim (2026-07-23)

- `packages/shared` now holds the whole deterministic sim: `constants.ts` (tuning), `types.ts`, `math.ts`, `collision.ts` (circle-vs-AABB with a shallowest-face escape for deep overlap, equal-mass ninja pair resolve), `map.ts` (`DOJO_ARENA`: 1280x720, border walls, 5x3 destructible grid, 4 spawns), `sim.ts` (`createSimState` / `step` / `applyLaunch` / `resetObstacles`).
- `step(state, commands)` advances exactly one fixed 1/30s tick and returns `SimEvent[]` (launch, ninjaHit, wallHit, obstacleHit, obstacleDestroyed). No clock, no randomness, fixed iteration order; damping is a per-tick constant (no `pow`) and lengths use `Math.sqrt` (no `Math.hypot`) to keep server and client bit-identical.
- Scope boundary held: S2 is physics + obstacle destruction + events. HP/KO/respawn/TP/SP are S6 rules that consume those events. Obstacles shatter without bouncing so a hard dash carries through.
- Added **vitest** as a devDependency of `shared`; 27 tests cover collision math, launch mapping, damping-to-rest, destruction, knockback, plus determinism (identical scripts → bit-identical state) and a 3600-tick chaos run asserting containment and no residual overlap.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass across all packages.
- **Next:** S3 — Phaser renderer + skin layer + pointer drag input (grab radius, aim line, launch); playable solo in one tab. Model: Sonnet.
- **Open issues:** knockback/damping numbers are first-pass guesses — expect a feel pass once S3 makes them playable.
