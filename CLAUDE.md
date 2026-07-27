# Ougi Arena — Project Guidance

Fun-first real-time multiplayer browser brawler inspired by Nindou. Full plan and decisions live in [docs/mvp-plan.md](docs/mvp-plan.md); requirements and post-MVP roadmap in [docs/prd.md](docs/prd.md).

## Session workflow

- One session = one deliverable from the session table in `docs/mvp-plan.md`. Reset context between sessions — never bleed one deliverable into the next.
- **Start of every session:** read this file, `docs/activity-log.md`, and the relevant slice of `docs/mvp-plan.md`. Nothing else is assumed remembered.
- **End of every session:** typecheck + lint pass, commit with a clear message, append a 3–5 line entry to `docs/activity-log.md` (what was done, what's next, any open issues).
- If a deliverable isn't done when context gets long: stop, commit what works, log the exact stopping point, continue in a fresh session.

## Model policy

- **Fable** — planning only (architecture, design reviews, milestone re-scoping). Never for writing code.
- **Opus** — correctness-critical work: the shared deterministic sim, authoritative room tick + state sync + interpolation/optimistic-launch, Ougi effect logic, latency tuning, desync/physics debugging.
- **Sonnet** — everything else: scaffolding, Phaser scenes/UI, lobby flow, bots, skin layer, config, deploy, docs, routine fixes.

Rule of thumb: anything touching the sim or how state moves between server and client is Opus; everything player-facing around it is Sonnet.

## Stack

TypeScript (strict) pnpm monorepo:
- `packages/shared` — deterministic sim, types, map data (no dependencies on server/client)
- `packages/server` — Node + Colyseus authoritative rooms
- `packages/client` — Phaser 3 + Vite

No accounts, no DB — rooms are ephemeral, player = `{ nickname, characterId, session }`.

## Commands

```bash
pnpm install
pnpm dev         # client (Vite) + server (Colyseus) with hot reload
pnpm test        # per-package tests (sim unit tests land in S2)
pnpm typecheck
pnpm lint
```

## Conventions

- TS strict everywhere; avoid `any`.
- `packages/server` uses `@colyseus/schema` decorators — requires `experimentalDecorators: true` in its tsconfig (see `packages/server/tsconfig.json`).
- Comments are one line, explain *why* not *what*.
- No Nindou assets or branding, ever. Beyond that: in-game art stays code-drawn or CC0 (AI is unreliable at
  consistent 16x16 sheets); brand/marketing art may be AI-generated. Record every asset's provenance in
  `docs/asset-credits.md`.
