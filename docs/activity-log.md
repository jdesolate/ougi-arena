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
