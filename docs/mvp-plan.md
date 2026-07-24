# Ougi Arena — MVP Plan

A multiplayer online browser game inspired by Nindou (slingshot ninja brawler).
Purpose: **a game to genuinely enjoy and share** — fun, seamless, always playable, free to host. Portfolio value is a welcome side effect, not a design constraint.

## Decisions (resolved 2026-07-22, revised 2026-07-23 and 2026-07-25)

> Revision note: the original plan optimized for portfolio defensibility (hand-rolled `ws` netcode, custom prediction/reconciliation, PixiJS). On 2026-07-23 the goal shifted to fun-first with free hosting, so the stack moved to Colyseus + Phaser, full prediction was cut in favor of interpolation + optimistic launch, and bots + Quick Play moved into the MVP.
>
> Revision note (2026-07-25, after the first real playtest): four gameplay changes came out of playing it and out of studying a real Nindou map. Movement flips from pull-back slingshot to **drag toward where you want to land**, now landing on **cell centres**; ninjas get **nameplates** because identical characters are indistinguishable mid-fight; the arena is rebuilt on an **80-unit cell grid with three authored maps**, dense pillars and choke points; and dashing stops being the only way to kill — **melee weapons** join it. These add milestone **M6** (S11–S15), which runs before deploy, so the old S11/S12 (deploy, ship) become **S16/S17**.
>
> On the grid question specifically: a reference Nindou map was analysed as using tile-locked, hold-a-direction stepping. We adopted its **spatial** reading (dense pillar field, 1-cell chokes, breakable clutter in corners) and rejected the **movement** reading — the evidence for it is thin, it is Bomberman's model rather than a drag-dash game's, and it would discard the deterministic dash sim, optimistic launch, S9's reconciliation work and the drag gesture itself. The compromise is that the *world* is quantised and dash destinations snap to cell centres, while the ninja still moves continuously between them.

### Purpose
- Fun for the author and friends first; inviting strangers second; portfolio third. No monetization.
- Must run on free tiers ($0/month), with a documented cheap upgrade path.

### Core gameplay
- Real-time combat with TP-gated discrete dashes. Press and hold your own ninja (generous grab radius, ~2–3x sprite size) to charge TP, then **drag toward the spot you want to land on** and release to launch. Launch direction snaps to the 4 cardinal directions only — no diagonal dashes, matching Nindou's original movement.
- **Drag-toward movement, revised 2026-07-25** (was a pull-back slingshot through S10): the drag now points *at* the destination rather than away from it, and the mapping is 1:1 — you drag to the spot you want, capped by current TP, so the aim line shows the real landing spot. The client's input mapping is the only change needed for this half; the sim still takes `{dir, power}`, with `power = dragDistance / maxDashDistance`.
- **Cell-snapped landing**: a dash resolves to the nearest **cell centre** along its axis, so every landing is on a tile — a dash reads as "three tiles left", chess-style, and TP reads as tiles of range. See the arena grid section below for why this also keeps the whole board self-aligning.
- **Exact-distance dash, revised 2026-07-23**: the drag distance sets a target point capped by current TP (chessboard-style — you go exactly as far as the arrow reaches, no ballistic overshoot). A dash runs at constant launch speed with no damping tail (S9), so it lands on the target point exactly rather than a few units short. A dash hard-stops instantly on contact with a wall or obstacle (no bounce), whether or not the hit breaks the obstacle. A dash that reaches an enemy ninja passes through and shatters (instantly KOs) them instead of stopping, continuing on to the target point.
- **Weapons, added 2026-07-25**: dashing is no longer the only way to kill. Every ninja carries one melee weapon and attacks the cells directly in front of it. Design detail below.
- **Nameplates**: each ninja renders its nickname above its HP bar (bots labeled as such, local player distinguished). Characters repeat in a room, so without this you cannot tell which ninja is yours mid-fight.
- 2–4 player free-for-all rooms, joinable by shared link or Quick Play.
- Match: 2-minute timed kill-count. HP-based KOs, ~3s respawn with ~2s invulnerability, sudden-death next-KO tiebreak.
- 3–4 ninjas, identical base stats; each character is defined by one Ougi (ultimate). SP charges by dealing damage only; Ougi fires at max SP. **Weapon is a second, independent pick** (see below), so character and weapon combine rather than being one choice.
- **Three arenas** (revised 2026-07-25 from one), each authored as ASCII rows in a data file: hard pillars + destructible crates and hay (AABB with HP + alive flag). Obstacles do not respawn within a match; the grid resets at match start. Host picks the map in the lobby.
- **AI bots fill empty slots and power a practice mode — in MVP** (the game must be fun even with zero other players online).

### Arena grid & maps (added 2026-07-25)

Studying a real Nindou map made clear that its character comes from level geometry, not from a movement model: a dense field of stone pillars forming 1-tile choke points, breakable clutter (hay, baskets) tucked into corners as temporary cover, and a hard foliage border. All of that is expressible in the sim we already have.

- **`CELL = 80` world units is the single spatial quantum.** The existing 1280x720 arena with its 40px border is exactly **15 x 8 cells** of playable space, which is why 80 was chosen over 60. It makes the numbers read in tiles: a full-TP dash (400) is **5 tiles**, a longsword reaches 2 tiles, an obstacle fills 1 tile. Obstacle boxes grow from 60 to 80 and weapon cells use this same constant.
- **Dash destinations snap to cell centres.** `applyLaunch` resolves the requested distance to the nearest cell centre along the launch axis, then clamps to TP — and it must clamp **down to the nearest reachable cell**, never up, or a dash would overspend its tank.
- **Snapping is self-correcting, which is what makes it safe.** A ninja can end up off-grid (knocked back by Shockwave, bumped by an idle collision, or hard-stopped mid-cell by a pillar it dashed into). Because the *destination* snaps rather than the position, the very next dash pulls that ninja back onto the grid. No separate re-alignment logic, and no way to get permanently wedged between cells.
- **Three obstacle tiers**, all pure map data:

  | Tier | Stored in | Behaviour |
  |---|---|---|
  | **Stone pillar** | `map.walls` | Indestructible. Hard cover, blocks dashes and Cross Slash lanes, forms the choke points. |
  | **Crate / basket** | `map.obstacles` | Today's 100 HP destructible. |
  | **Hay bale** | `map.obstacles` | Weak tier, 1–2 hits. Corner pockets you can clear fast to open an escape. |

  Pillars need **no sim work at all** — `sim.ts` already collides ninjas against `map.walls`, which so far has only ever held the border. The hay tier is the one real change: obstacles need per-entry HP in map data instead of a global `OBSTACLE_HP`.
- **Maps are authored as ASCII rows** (`#` pillar, `x` crate, `o` hay, `.` floor, digits for spawns) and parsed into an `ArenaMap`. A map becomes ~10 lines of text in a data file, which is what makes three of them nearly free once the parser exists. `ArenaMap` is already the data contract and needs no shape change beyond obstacle HP.
- **Three arenas ship; the host picks one in the lobby.** The chosen `mapId` syncs on the room schema and the client resolves it from the shared registry. *This revises the MVP non-goal "more than one arena map"* — justified because the parser, not the map count, is the actual work.
- **Y-sorting** so tall pillars occlude ninjas behind them: the renderer currently draws all ninjas at a flat `DEPTH_NINJA` above a single world graphics layer, so pillars become their own sprites depth-sorted by the y of their bottom edge. Presentation only, no sim involvement.
- **Known feel risk:** a dense pillar field plus the existing hard-stop-on-contact rule means mid-map dashes get much shorter than the open arena's. That is the intended close-quarters pressure, but pillar density is the first thing to tune if dashing starts feeling strangled, and bots lean harder on `laneDistance` avoidance than they did in the open map.

### Weapons (added 2026-07-25)

Dashing through someone is a high-commitment, all-or-nothing kill. Weapons add the short-range, low-commitment option Nindou had, so standing next to an enemy is a threat rather than a stalemate.

- **The weapon is a separate pick at character select.** Character decides your Ougi, weapon decides your attack — 3x3 combinations from 3 characters. This also leaves the Ougi slot addressable from the weapon, which is what the future special weapon (below) needs.
- **Attacks are cell-shaped, not swept arcs.** A weapon is a list of cell offsets relative to the direction you swing, measured in the arena's own `CELL` (80 world units) — the same grid the map is authored on and the same size as an obstacle box, so "one box in front" is literal, and a swing lines up visually with the tiles under it. Cells rotate with the swing direction; direction snaps to the same 4 cardinals as movement (`snapToCardinal`), so there are exactly 4 attack shapes per weapon and no aiming precision to master.

  | Weapon | Cells hit (relative to facing) | Speed | Damage | Role |
  |---|---|---|---|---|
  | **Kunai** | 1 — directly in front | Fastest | Lowest | Poke, chip, safe pressure |
  | **Paper fan** | 3 — front, front-left, front-right | Medium | Medium | Crowd control, covers approach angles |
  | **Longsword** | 2 — front, and one cell beyond it | Slowest | Highest | Reach; punishes a committed dash |

- **Attacks chip HP; they do not instant-kill.** Damage runs through the existing `damageNinja` path, so it charges SP by damage dealt (FR-12) and KOs at 0 HP. Dash-shatter stays the *only* instant kill, which keeps dashing meaningful now that it isn't the only offense.
- **Attack speed is a per-weapon cooldown** (`cooldownTicks`) held on `NinjaState.attackCooldown`. An attack arriving while on cooldown is dropped, not buffered — buffering makes latency feel like input lag in the wrong direction.
- **Attacks damage obstacles in the hit cells too**, at the same damage, so a weapon can open a lane through the grid instead of only a dash doing it.
- **Attacks cost no TP.** TP stays purely the dash resource; the cooldown is the rate limit. If attack spam turns out to dominate, a small TP cost is the tuning lever, not a redesign.
- **Authority and feel**: an attack is a `SimCommand` alongside launch/ougi — the server resolves all damage. The client plays the swing animation and its SFX at 0ms on input (same trick as the optimistic launch's dash sound) but predicts no damage, so a mispredicted hit costs an animation, never a desync.
- **Facing** becomes real state (`NinjaState.facing`), set by whichever came last of a dash or an attack, and used for sprite orientation as well as the attack shape.
- **Future — the special weapon (post-MVP).** A 4th weapon whose Ougi lives on the *weapon* rather than the character, charged by weapon hits and KOs rather than damage generally. Not in the MVP; the reason weapon and character are separate picks is so this drops in as a weapon-level `ougiId` override instead of a fourth character.

### Simulation & physics
- Hand-rolled deterministic fixed-timestep sim: impulse, linear damping, circle-vs-AABB collision. No physics engine — it stays ~200 lines, runs identically on server and client, and stays inspectable.
- Walls and obstacles hard-stop a dash on contact (`stopAtContact`) rather than bouncing it — movement is clipped to an exact `dashBudget` distance set at launch, so a dash never travels further than its drag reached. Ninja-vs-ninja contact still uses elastic-ish knockback (`resolveNinjaPair`) as a placeholder until S6 replaces it with the shatter-KO rule above.
- Sim lives in the shared package; the Colyseus room runs it authoritatively.

### Netcode
- **Colyseus** (MIT, self-hostable) provides rooms, matchmaking, delta state sync, client SDK, and reconnection handling. We do not hand-roll the transport layer.
- Server-authoritative: the room advances the shared sim at 30Hz; Colyseus schema sync broadcasts state.
- Client feel: aim line renders locally at 0ms; **optimistic local launch** starts the dash immediately on release; remote entities render with snapshot interpolation (~100ms). Full rewind-replay prediction is a backlog item, built only if playtests at realistic latency feel bad — Nindou itself was a thin client and discrete dashes are latency-tolerant.
- **S9 verdict (2026-07-23): rewind-replay prediction is not needed.** Measured at 200ms simulated RTT, the only visible artifact was a snap-back after a dash, and its cause was reconciliation *timing*, not prediction depth: the client resumed snapping to server positions that either predated its launch or were still mid-dash. Gating reconciliation on a server launch receipt plus a synced `dashing` flag removed it entirely (0 corrections, no backwards motion). Because both sims run the same deterministic dash from the same start point, an uncontested dash needs no replay at all.
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

## Milestones (~10 hrs/week → roughly 9–12 weeks)

1. **M1 — Local playable** (~2 wks): scaffold, shared sim, Phaser client, drag input. Playable solo, no server.
2. **M2 — Multiplayer** (~2 wks): Colyseus rooms, link join, authoritative tick + state sync, interpolation + optimistic launch, reconnection. Two tabs can fight.
3. **M3 — The game** (~2 wks): HP/KO/respawn, TP/SP, match timer, scoreboard, rematch, 3 Ougis, character select.
4. **M4 — Always playable** (~1.5 wks): bots + practice mode, Quick Play, public room list, latency feel pass.
5. **M5 — Presentation** (~1 wk): juice pass, art/audio swap, character select screen. *(Originally "Ship"; deploy and ship split out to M7 when M6 was inserted on 2026-07-25.)*
6. **M6 — The Nindou pass** (~3 wks): drag-toward movement, nameplates, the 80-unit arena grid with cell-snapped dashes, 3 authored maps, and the weapon system + 3 weapons. Comes from the first real playtest and from studying a real Nindou map; runs **before** deploy, because reworking core combat and arena geometry after shipping is the expensive order.
7. **M7 — Ship** (~1 wk): Render + CF Pages deploy, light mobile pass, README + demo video, playtest tuning.

Scope-cut levers if needed, in the order they should be pulled: the third map, then the fan and longsword (the kunai alone is a shippable weapon set — the weapon *framework* is what must land), then map selection UI (ship one grid arena). M3's old lever — one Ougi, two characters — still stands behind those.

## Claude Code session plan

One session = one focused deliverable that fits comfortably in a single context window. Reset context (`/clear` or new session) between sessions — never let a session bleed into the next deliverable.

### Session workflow rules

- **Start of every session:** Claude reads `CLAUDE.md`, `docs/activity-log.md`, and the relevant slice of this plan. Nothing else is assumed remembered.
- **End of every session:** typecheck + lint pass, commit with a clear message, append a 3–5 line entry to `docs/activity-log.md` (what was done, what's next, any open issues). The log is the memory between sessions.
- **Milestone kickoffs** (S2, S5, S9, S12) may start with a short Fable planning pass; everything else goes straight to implementation.
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
| S11 | Feel pass (client-only): drag-toward launch with 1:1 landing point, nameplates above each ninja, and the human mouse-drag playtest owed since S9 — dash feel, constant-speed dash, hit-pause | Sonnet | M6 |
| S12 | Arena grid in the sim: `CELL = 80` regrid of `DOJO_ARENA`, cell-snapped dash landing in `applyLaunch` (clamped down to the nearest reachable cell), per-obstacle HP so hay and crates differ, ASCII map parser, tests for snapping + off-grid recovery | Opus | M6 |
| S13 | Arenas, player-facing: 3 maps authored as ASCII (pillar chokes, corner hay pockets), `mapId` synced + host map picker in the lobby, Y-sorted pillar sprites, destination-tile highlight on the aim line | Sonnet | M6 |
| S14 | Weapons in the sim: `facing` + `attackCooldown` on `NinjaState`, `AttackCommand`, weapon table with `CELL`-offset patterns (kunai/fan/longsword), per-weapon damage + cooldown, obstacle damage, `ninjaAttacked` event, unit tests | Opus | M6 |
| S15 | Weapons, player-facing: tap-to-swing input + 0ms swing animation, per-weapon effects/SFX, weapon pick in character select, cooldown on the HUD, bots swing when a target is in range | Sonnet | M6 |
| S16 | Deploy *(was S11)*: Render (server) + Cloudflare Pages (client), CORS/env config, "waking the dojo" cold-start UX, light mobile/responsive pass, production smoke test with remote players | Sonnet | M7 |
| S17 | Ship *(was S12)*: README + architecture diagram, demo video capture, playtest round with friends + tuning fixes | Sonnet | M7 |

17 sessions at 3–4 focused hours each. Sessions are sequential; don't parallelize across milestones.

**Why M6 is ordered this way.** S11 is pure client work that makes the game legible enough to playtest properly, and it finally clears the feel debt from S9/S10 where nothing was ever driven by a real mouse — the rest of M6 should be designed against a version someone has actually played. The grid (S12) comes before weapons (S14) because `CELL` is the constant weapon patterns are measured in; doing weapons first would mean specifying them against a number that then changes. Each Opus session is paired with the Sonnet session that makes it visible, so a sim change is never left unplayable across a context reset.
