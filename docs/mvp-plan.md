# Ougi Arena — MVP Plan

A multiplayer online browser game inspired by Nindou (slingshot ninja brawler).
Purpose: **a game to genuinely enjoy and share** — fun, seamless, always playable, free to host. Portfolio value is a welcome side effect, not a design constraint.

## Decisions (resolved 2026-07-22, revised 2026-07-23)

> Revision note: the original plan optimized for portfolio defensibility (hand-rolled `ws` netcode, custom prediction/reconciliation, PixiJS). On 2026-07-23 the goal shifted to fun-first with free hosting, so the stack moved to Colyseus + Phaser, full prediction was cut in favor of interpolation + optimistic launch, and bots + Quick Play moved into the MVP.

### Purpose
- Fun for the author and friends first; inviting strangers second; portfolio third. No monetization.
- Must run on free tiers ($0/month), with a documented cheap upgrade path.

### Core gameplay (unchanged from original grilling)
- Real-time combat with TP-gated discrete slingshot dashes (Nindou-style: press on your ninja, pull back, release to launch). Generous grab radius (~2–3x sprite size).
- 2–4 player free-for-all rooms, joinable by shared link or Quick Play.
- Match: 2-minute timed kill-count. HP-based KOs, ~3s respawn with ~2s invulnerability, sudden-death next-KO tiebreak.
- 3–4 ninjas, identical base stats; each character is defined by one Ougi (ultimate). SP charges by dealing damage only; Ougi fires at max SP.
- One arena, defined as a data file: walls + grid of destructible obstacles (AABB with HP + alive flag). Obstacles do not respawn within a match; grid resets at match start.
- **AI bots fill empty slots and power a practice mode — in MVP** (the game must be fun even with zero other players online).

### Simulation & physics
- Hand-rolled deterministic fixed-timestep sim: impulse, linear damping, circle-vs-circle and circle-vs-AABB collision, elastic-ish ninja-vs-ninja knockback. No physics engine — it stays ~200 lines, runs identically on server and client, and stays inspectable.
- Sim lives in the shared package; the Colyseus room runs it authoritatively.

### Netcode
- **Colyseus** (MIT, self-hostable) provides rooms, matchmaking, delta state sync, client SDK, and reconnection handling. We do not hand-roll the transport layer.
- Server-authoritative: the room advances the shared sim at 30Hz; Colyseus schema sync broadcasts state.
- Client feel: aim line renders locally at 0ms; **optimistic local launch** starts the dash immediately on release; remote entities render with snapshot interpolation (~100ms). Full rewind-replay prediction is a backlog item, built only if playtests at realistic latency feel bad — Nindou itself was a thin client and discrete dashes are latency-tolerant.
- **Reconnection is a first-class requirement**: a dropped socket (wifi blip, phone lock) rejoins the same match within a grace window via Colyseus `allowReconnection`.

### Stack
- TypeScript monorepo: `shared` (sim, types, map data), `server` (Node + Colyseus), `client` (**Phaser 3** + Vite).
- Phaser owns rendering, scenes, input, audio, particles, tweens, camera effects — juice is the product.
- Input via Pointer Events / Phaser pointer API (touch works; desktop-first, light mobile pass in ship milestone).

### Rooms & identity
- No accounts, no DB, no persistence; player = `{ nickname, characterId, session }`.
- Join paths: shared link (`/r/AB3XK9`), **Quick Play** (auto-join an open public room or create one), or public room list on the landing page.
- Rooms are public by default with a private toggle at creation. Free-text length-capped nicknames. Host starts the match; host migration to oldest player. Mid-match joiners spectate until next match; bots yield slots to humans at match boundaries. Rematch keeps the room alive.

### Hosting (free tier)
- **Server:** Render free tier web service (750 hrs/month covers always-on). It sleeps after ~15 min idle → first player may wait ~30–60s; the client shows a friendly "waking the dojo…" loading state. Upgrade path: Render paid (~$7/mo) removes cold starts.
- **Client:** Cloudflare Pages (free, global CDN). CORS configured for the Pages origin; WS URL via env config.

### Art & audio
- Placeholder-first (shapes), asset-agnostic skin layer from day one, then one timeboxed pass swapping in a coherent free/cheap chibi 2D pack + ~8 CC0 SFX (dash, hit, break, KO, per-character Ougi, countdown, whistle).
- A dedicated juice pass (particles, screen shake, hit-pause, tweens) is scheduled work, not leftover polish.
- Original names and designs only. "Inspired by Nindou" in README; no Nindou art, names, or logos in-game.

## Claude Code model usage

- **Fable — planning only.** Architecture decisions, design reviews, milestone re-scoping, grilling sessions. Not for writing code.
- **Opus — correctness-critical work.** The shared deterministic sim, the authoritative room tick + state sync + interpolation/optimistic-launch feel, Ougi effect logic, latency tuning, and debugging desyncs or physics edge cases.
- **Sonnet — everything else.** Scaffolding, Phaser scenes/UI, lobby flow, bots, skin layer, config, deploy, README drafting, routine edits and fixes.

Rule of thumb: anything touching the sim or how state moves between server and client is Opus; everything player-facing around it is Sonnet, escalating when a bug crosses that boundary.

## Milestones (~10 hrs/week → roughly 7–10 weeks)

1. **M1 — Local playable** (~2 wks): scaffold, shared sim, Phaser client, drag input. Playable solo, no server.
2. **M2 — Multiplayer** (~2 wks): Colyseus rooms, link join, authoritative tick + state sync, interpolation + optimistic launch, reconnection. Two tabs can fight.
3. **M3 — The game** (~2 wks): HP/KO/respawn, TP/SP, match timer, scoreboard, rematch, 3 Ougis, character select.
4. **M4 — Always playable** (~1.5 wks): bots + practice mode, Quick Play, public room list, latency feel pass.
5. **M5 — Ship** (~1.5 wks): juice + art/audio pass, Render + CF Pages deploy, light mobile pass, README + demo video, playtest tuning.

Scope-cut lever if needed: M3 shrinks to one Ougi and two characters; the public room list can slip to post-MVP (Quick Play cannot).

## Claude Code session plan

One session = one focused deliverable that fits comfortably in a single context window. Reset context (`/clear` or new session) between sessions — never let a session bleed into the next deliverable.

### Session workflow rules

- **Start of every session:** Claude reads `CLAUDE.md`, `docs/activity-log.md`, and the relevant slice of this plan. Nothing else is assumed remembered.
- **End of every session:** typecheck + lint pass, commit with a clear message, append a 3–5 line entry to `docs/activity-log.md` (what was done, what's next, any open issues). The log is the memory between sessions.
- **Milestone kickoffs** (S2, S5, S9) may start with a short Fable planning pass; everything else goes straight to implementation.
- If a session's deliverable isn't done when context gets long, stop, commit what works, log the exact stopping point, and continue in a fresh session — don't push through with a degraded context. Merged sessions list their parts in build order, so the seam between parts is the natural stopping point.

### Sessions

| # | Deliverable | Model | Milestone |
|---|-------------|-------|-----------|
| S1 | Project setup + scaffold: `git init`, project `CLAUDE.md`, `docs/activity-log.md`; pnpm monorepo (`shared`/`server`/`client`), TS strict, Phaser 3 + Vite client boots, Colyseus server boots | Sonnet | M1 |
| S2 | Full shared sim: fixed-timestep step function, impulse + damping, circle-vs-circle and circle-vs-AABB collision, destructible obstacles, map data file, knockback tuning, unit tests | Opus | M1 |
| S3 | Phaser renderer + skin layer + pointer drag input (grab radius, aim line, launch); playable solo in one tab | Sonnet | M1 |
| S4 | Colyseus rooms + lobby: create/join by link code, public/private flag, nickname flow, host start + migration, spectate-on-mid-join, reconnection via `allowReconnection` | Sonnet | M2 |
| S5 | Authoritative room: shared sim at 30Hz, schema state sync, client interpolation (~100ms) + optimistic local launch; two tabs can fight | Opus | M2 |
| S6 | Match rules: HP/KO/respawn/invulnerability, TP costs, SP-on-damage meters, match timer, scoring, scoreboard, sudden death, working rematch | Sonnet | M3 |
| S7 | Ougi framework (server-side effect functions) + 3 Ougis | Opus | M3 |
| S8 | Bots: dash-at-nearest AI filling empty slots, yield-to-human at match boundaries, practice mode vs bots | Sonnet | M4 |
| S9 | Quick Play + public room list + latency feel pass: test under throttled/jittery network, tune interpolation and launch feel; decide whether prediction is actually needed | Opus | M4 |
| S10 | Presentation: character select screen, lobby UI, juice pass (particles, screen shake, hit-pause, tweens), skin swap to chosen asset pack, ~8 CC0 SFX | Sonnet | M5 |
| S11 | Deploy: Render (server) + Cloudflare Pages (client), CORS/env config, "waking the dojo" cold-start UX, light mobile/responsive pass, production smoke test with remote players | Sonnet | M5 |
| S12 | Ship: README + architecture diagram, demo video capture, playtest round with friends + tuning fixes | Sonnet | M5 |

12 sessions at 3–4 focused hours each. Sessions are sequential; don't parallelize across milestones.
