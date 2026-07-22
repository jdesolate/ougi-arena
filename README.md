# Ougi Arena

A real-time multiplayer browser brawler inspired by the classic slingshot ninja game *Nindou*. Chibi ninjas slingshot-dash around a destructible arena in 2-minute free-for-all matches, charging their ultimate move — their **Ougi** — by dealing damage.

> **Status: pre-development.** Design and planning are complete; implementation has not started. See the roadmap below.

## What it is

- **2–4 player free-for-all** — hit Quick Play, share a room link, or pick from the public room list. No accounts, no installs, just a URL.
- **Always playable:** AI bots fill empty slots, so a solo visitor gets a real match immediately.
- **Slingshot movement:** grab your ninja, pull back, release to launch. Dashes cost TP; landing hits charges SP; max SP unleashes your character's unique Ougi.
- **Destructible arena:** smash through the obstacle grid and open up the map as the match progresses.
- **2-minute matches:** most KOs at the bell wins; sudden death on ties.
- **Seamless:** drop your wifi mid-match and rejoin the same game; aim feels instant at real-world latency.

## Why it exists

*Nindou* was a wonderful, chaotic little browser game that no longer exists. Ougi Arena is a love letter to it — built first and foremost to be *fun*: quick to join, satisfying to play, and free to run so anyone can be invited.

Under the hood it still has an interesting engine: a hand-rolled deterministic fixed-timestep simulation shared verbatim between server and client, run authoritatively inside Colyseus rooms at 30Hz, with local-first aiming, optimistic dash launches, snapshot interpolation, and seamless mid-match reconnection.

## Tech stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict), pnpm monorepo: `shared` / `server` / `client` |
| Multiplayer server | Node.js + [Colyseus](https://colyseus.io) — rooms, state sync, matchmaking, reconnection |
| Client | [Phaser 3](https://phaser.io) + Vite — rendering, input, audio, particles, juice |
| Simulation | Custom deterministic fixed-timestep sim in `shared` (impulse, damping, circle/AABB collision) |
| Hosting | Server on Render (free tier), client on Cloudflare Pages (free) — $0/month |

## Development

> Setup instructions will land with the first scaffold (session S1). Planned shape:

```bash
pnpm install
pnpm dev        # client (Vite) + Colyseus server with hot reload
pnpm test       # simulation unit tests
pnpm typecheck && pnpm lint
```

## Roadmap

**MVP** (see [docs/mvp-plan.md](docs/mvp-plan.md) for the full session-by-session plan):

1. **M1** — Local sim + Phaser client, playable solo
2. **M2** — Colyseus rooms, authoritative server, interpolation + optimistic launch, reconnection
3. **M3** — Match rules, TP/SP, character select, 3 Ougis
4. **M4** — Bots + practice mode, Quick Play, public room list, latency feel pass
5. **M5** — Juice + art/audio pass, free-tier deploy, mobile-lite pass, demo video

**Post-MVP** (see [docs/prd.md](docs/prd.md) for the full PRD and roadmap):

- Prediction upgrade if real-world latency demands it; proper mobile pass
- *Save the Princess* 2v2 objective mode, more characters and maps, smarter bots
- If it finds players: always-on hosting, accounts, stats, replays, moderation

## Credits & legal

Inspired by *Nindou*, a browser game fondly remembered and long gone. Ougi Arena contains no Nindou assets, names, or artwork — all art and audio are original, licensed, or CC0.
