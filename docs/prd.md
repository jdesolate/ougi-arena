# Ougi Arena — Product Requirements Document

**Status:** MVP shipped (M7 complete), live at https://ougi-arena.j-desolate53.workers.dev · **Owner:** Merv · **Last updated:** 2026-07-27
**Companion docs:** [mvp-plan.md](mvp-plan.md) (decisions, milestones, session plan)

## 1. Overview

Ougi Arena is a real-time multiplayer browser game inspired by the defunct browser brawler Nindou. Chibi ninjas dash around a destructible arena and swing short-range weapons at each other in free-for-all matches, charging an ultimate move (Ougi) by dealing damage.

Primary purpose: **a game the author genuinely enjoys and can share** — seamless to join, fun within seconds, always playable (bots fill empty slots), and hosted entirely on free tiers. Engineering/portfolio value is secondary.

## 2. Goals and non-goals

### Goals
1. A polished, deployed, publicly playable 2–4 player match experience reachable in under 30 seconds from landing page to first dash (Quick Play or shared link).
2. Always playable: a solo visitor gets a fun match against bots immediately.
3. Feels good at realistic internet latency (target: playable at 150ms RTT) and survives connection blips via seamless reconnection.
4. $0/month hosting with a documented cheap upgrade path when players arrive.

### Non-goals (MVP)
- Accounts, persistence, progression, or monetization.
- Ranked or skill-based matchmaking (Quick Play is "fill any open room," not ELO).
- Fully mobile-optimized UI (touch works and gets a light pass; desktop-first).
- Anti-cheat beyond server authority.
- ~~More than one arena map.~~ *Revised 2026-07-25: three arenas ship. Once maps are authored as ASCII rows and parsed into the existing `ArenaMap` contract, the parser is the work and each additional map is ~10 lines of text. A map editor, user-made maps, or per-map rulesets remain non-goals.*

## 3. Target users

1. **The author and friends** playing casual matches via Quick Play or shared links.
2. **Invited strangers** (communities, social posts) who should get into a fun match without reading anything first — movement is discoverable by grabbing your ninja, and clicking a target elsewhere now swings at it (FR-25) without needing to be taught; the countdown legend (FR-30) still exists to confirm the gesture and cover dash/charge/ougi rather than by a manual or a tutorial gate.
3. **Recruiters/engineers** skimming the README and demo video (secondary).

## 4. Functional requirements

### 4.1 Rooms and lobby
- FR-1: Create a room from the landing page (public by default, private toggle); receive a shareable URL (`/r/<code>`).
- FR-2: Join via link, Quick Play (auto-joins an open public room or creates one), or the public room list on the landing page.
- FR-3: Join flow asks only for a nickname (free text, length-capped), character selection, and weapon selection. *(Weapon added 2026-07-27: S15 made it a separate pick from character, per FR-22.)*
- FR-4: Rooms hold 2–4 players; host starts the match; host migrates to the oldest player on disconnect.
- FR-5: Mid-match joiners spectate until the next match; rematch button restarts within the same room.
- FR-6: Rooms live in server memory only and are destroyed when empty.
- FR-7: A disconnected player (network blip, tab/phone sleep) can rejoin the same live match within a grace window (~30s) with their state intact.
- FR-32: A player can leave a match at any time and return to the landing page, from an Esc/menu-button pause overlay mid-match or from the match-end screen (available to everyone, not just the host). Pausing is client-side only — the authoritative match runs on — and leaving is a *consented* departure: the seat is released immediately rather than held open by FR-7's grace window, and the client can start a fresh match afterwards without a reload. *(Added 2026-07-28 with M8's S25; before it, lobby-to-match was one-way.)*

### 4.2 Core gameplay
- FR-8: Drag-toward movement — press and hold your own ninja (generous grab radius) to charge TP, drag **toward the spot you want to land on**, release to launch. Launch direction is locked to the 4 cardinal directions (up/down/left/right), Nindou-style — no diagonal dashes. The drag maps 1:1 to distance: you land where the pointer is — snapped to the nearest cell centre per FR-28 — capped by the player's current TP (more TP = longer reach), and the dash travels precisely to that point and no further, no ballistic overshoot. A dash reads as "three tiles left", and TP reads as tiles of range. TP is spent by dashing and only recharges while holding. *(Revised 2026-07-25: this was a pull-back slingshot — drag away from the target — through S10. Playtesting found the inversion unintuitive.)*
- FR-9: A dash hard-stops the instant it contacts a wall or an obstacle — no bounce, no knockback carrying it past the contact point, whether or not the obstacle breaks. A dash that reaches an enemy ninja instead passes through, shattering (instantly KO'ing) that ninja and continuing on to the original target point.
- FR-10: Obstacles sit on the arena grid in three tiers: **indestructible stone pillars** (hard cover, form the choke points), **crates/baskets** at full HP, and **hay bales** that clear in 1–2 hits. Destructibles shatter when dashed through or struck by a weapon, and do not respawn within a match; the grid resets at match start.
- FR-11: Damage on ninja-vs-ninja hits; HP depletion causes KO. Being shattered by a passing dash (FR-9) is also an instant KO regardless of remaining HP. KO'd ninjas respawn at a random point on the map with reduced HP after a short delay, with a blinking invulnerability period on arrival before they can be damaged again. A shatter KO shows a smoke effect at the point of impact.
- FR-12: SP charges only by dealing damage; at max SP the player may fire their character's Ougi.
- FR-13: 3–4 selectable characters, identical base stats, each defined by one unique Ougi.
- FR-14: Matches are 2-minute timed kill-count; scoreboard at the end; sudden-death next-KO on ties.
- FR-22: Every ninja carries one melee weapon, picked at character select independently of character (character decides the Ougi, weapon decides the attack). At least 3 weapons ship: **kunai** (1 cell in front, fastest, lowest damage), **paper fan** (3 cells — front, front-left, front-right, medium speed and damage), **longsword** (2 cells — front and one beyond, slowest, highest damage). A weapon may also push what it hits: the fan shoves each victim one cell along the swing (the only weapon that does), which is what makes its coverage read as zone control rather than three hitboxes.
- FR-23: An attack hits a fixed set of grid cells relative to the swing direction, snapped to the same 4 cardinals as movement; a cell is obstacle-box sized so "one box in front" is literal. Attacks chip HP (KO at 0) rather than instant-killing, charge SP by damage dealt like any other damage source, and damage destructible obstacles in the hit cells. Dash-shatter (FR-9) remains the only instant kill.
- FR-24: Each weapon has its own attack speed, enforced as a per-weapon cooldown; an attack requested during cooldown is dropped, not queued. Attacks cost no TP.
- FR-25: Attack input is a tap/click **away from your own ninja** (outside the grab radius a dash starts from), which swings toward that point, snapped to the same 4 cardinals as movement. A tap directly on your own ninja is inert — no swing, no dash. One input scheme for touch and desktop alike. The swing animation and its sound play locally at 0ms optimistically; the server resolves all damage. *(Reverted 2026-07-27, same day as the revision below: this is the original spec. S15 had shipped a tap-on-your-ninja swing instead, documented as such earlier the same day — restored at the user's request once it turned out `attack()`'s arbitrary-direction handling was already built and unused by the client. Side effect: releasing an abandoned TP charge in place, previously an accidental swing, is now a true no-op.)*
- FR-30: A control legend showing all four inputs (drag to dash, tap away from your ninja to swing, hold to charge, Space for ougi) is shown during the match-start countdown, over a frozen arena, before the first fight of a session — confirming the gesture and covering dash/charge/ougi, which aren't self-evident even though the swing itself now is. *(Added 2026-07-27 after playtesting found the original tap-on-your-ninja shipped behavior undiscoverable; that behavior was itself reverted the same day — see FR-25 — which resolves most of the original problem but the legend still earns its slot for the other three inputs.)*
- FR-31: Every match, including a rematch, opens with a countdown during which the authoritative simulation does not advance, bots do not act, and player commands are held. The countdown is a real pause in the match, not an overlay drawn over a live one.
- FR-26: Each ninja renders its nickname above its HP bar, small but always legible; bots are labeled and the local player's own plate is visually distinguished. Characters repeat within a room, so a plate is the only way to find yourself mid-fight.
- FR-27: Arenas are built on an 80-unit cell grid — the same unit weapon patterns are measured in — giving a 15 x 8 playable board. Layouts follow the reference game's shape: dense pillars forming 1-cell choke points, open mid-lanes for dodging, and breakable clutter in corner pockets.
- FR-28: A dash resolves to the nearest cell centre along its axis, clamped down to the nearest cell the player's TP can actually reach. A ninja knocked off-grid (Ougi knockback, an idle bump, a dash hard-stopped mid-cell by a pillar) is realigned by its next dash — snapping the destination, not the position, means no ninja can be wedged between cells.
- FR-29: Three arenas ship, authored as ASCII rows and parsed into `ArenaMap`. The host picks the map in the lobby; the choice syncs to all clients on the room schema.
- FR-30: Tall obstacles occlude ninjas standing behind them, via depth sorting on the y of each sprite's bottom edge.

### 4.3 Bots
- FR-15: AI bots fill empty room slots so every match has 2–4 combatants; bots yield their slot to joining humans at match boundaries.
- FR-16: Practice mode: a solo player can start a match against bots immediately.
- FR-17: Bot behavior is simple but credible (dash toward nearest target, basic obstacle avoidance, occasional Ougi use); bots are visibly labeled.

### 4.4 Netcode
- FR-18: Server is authoritative: a Colyseus room advances the shared deterministic simulation at 30Hz fixed timestep; state reaches clients via Colyseus delta sync.
- FR-19: Aiming is fully local (0ms feedback); release triggers an optimistic local launch while the server confirms.
- FR-20: Remote entities render with ~100ms snapshot interpolation.
- FR-21: Toggleable debug overlay: RTT, server tick, state age, correction events.

## 5. Non-functional requirements

- NFR-1: Client holds 60fps on a mid-range laptop with 4 players, particles, and full destructible grid.
- NFR-2: Playable (subjectively responsive dashes) at 150ms RTT with 2% packet loss; full rewind-replay prediction is added post-MVP only if this bar isn't met.
- NFR-3: Single free-tier server instance supports ≥15 concurrent rooms; degradation is graceful (room creation declined with a friendly message).
- NFR-4: Hosting is $0/month: server on Render free tier, client on Cloudflare Pages. Cold starts (~30–60s after idle) are wrapped in a friendly loading state, never a blank screen or error.
- NFR-5: TypeScript strict mode throughout; simulation code shared verbatim between client and server.
- NFR-6: No copyrighted Nindou assets, names, or logos; all art/audio original, purchased, or CC0.
- NFR-7: Touch input works end-to-end (Pointer Events); layout is usable, if not optimized, on a phone in landscape.

## 6. Success criteria

- A stranger can go from landing page to their first dash in under 30 seconds with no instructions, alone (bots) or with friends.
- That same stranger lands their first *swing* in their first match — clicking a target away from your ninja (FR-25) is stumble-into-able the way dashing is; the countdown legend (FR-30) exists to confirm it and cover the other three inputs, not to rescue an undiscoverable gesture.
- Matches at 150ms simulated RTT feel responsive in blind playtests with friends.
- A wifi drop mid-match reconnects into the same match without losing the slot.
- The author still *wants* to play it after shipping — the fun bar, not just the works bar.

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Free-tier cold starts (~30–60s) turn first-time visitors away | "Waking the dojo" loading state with progress feedback; upgrade to ~$7/mo Render instance the moment real traffic exists |
| Interpolation + optimistic launch isn't enough at high latency | Latency feel pass (S9) tests under throttling before ship; rewind-replay prediction is the designed escape hatch, and the deterministic shared sim keeps it buildable |
| Free-tier CPU (Render) strains under many rooms | 30Hz sim of ≤4 circles + AABBs per room is cheap; NFR-3 caps rooms gracefully; Colyseus supports scaling out later |
| Determinism drift between client/server sim | Single shared TS sim package, fixed timestep, sim unit tests |
| Scope creep toward "real game" features | Non-goals list; post-MVP backlog absorbs ideas instead of the MVP |
| Bots feel like filler, not fun | Bot session includes tuning time; bots labeled honestly; practice mode framed as a feature |
| Weapons make dashing pointless, or vice versa | Dash keeps the only instant kill (FR-9); weapons only chip. Damage and cooldown are per-weapon data, so balance is a table edit, and the kunai alone is a shippable fallback if the set doesn't gel |
| A dense pillar grid strangles dashing — every launch hard-stops after one cell | Pillar density is per-map data, so it's tuned by editing text, not code; the three maps can deliberately span open-to-cramped. Watch it in the S13 playtest specifically |
| Cell-snapped landing makes dodging feel coarse or removes near-miss escapes | S11 playtests drag-toward *before* snapping lands in S12, so the two feel changes are judged separately rather than as one lump |

## 8. Post-MVP roadmap

Ordered by expected value for making the game more fun and more shared. None of these are commitments.

### Phase 1 — Feel and reach
- **Rewind-replay prediction** for own ninja, if the S9 latency pass showed it's needed at real-world pings.
- **Proper mobile pass**: responsive lobby, touch-sized UI, orientation handling, mobile performance budget — phones are how casual friends will join.
- **Room passwords** and basic profanity filtering as strangers arrive.

### Phase 2 — Depth
- **Team mode: Save the Princess** — 2v2 objective mode faithful to Nindou's flagship (barriers, objective HP, team assignment).
- **Special weapon with a weapon-bound Ougi** — a 4th weapon that carries its own ultimate instead of inheriting the character's, charged by weapon hits and KOs rather than damage dealt generally. The MVP keeps weapon and character as separate picks specifically so this lands as a weapon-level Ougi override, not a fourth character. Open design question when it comes up: whether the weapon Ougi replaces the character Ougi or fills a second meter.
- **More weapons** beyond the first three (reach vs speed vs coverage is a big enough axis to carry several).
- **More characters/Ougis** (target 6–8) and more arenas beyond the MVP's three (a map is ~10 lines of ASCII once the parser exists).
- **Map hazards and interactive props** — the reference game's roaming neutral creeps, loot-dropping baskets, statues. The grid and obstacle tiers make these additions to map data rather than new systems.
- **Smarter bots** (difficulty tiers, Ougi timing, target selection).
- **Local-storage progression**: cosmetics/stats without accounts.

### Phase 3 — If the game finds real players
- Paid always-on hosting; region selection by ping.
- Accounts (Supabase free tier), persistent stats, cosmetic unlocks.
- Quick-match with loose skill balancing; reporting/moderation tools.
- Spectator links and match replays (deterministic sim makes replays cheap: record inputs).

### Phase 4 — Engineering extras (optional, for the portfolio side)
- Technical write-up comparing thin-client vs optimistic-launch vs full prediction with measurements.
- Binary message encoding experiment; bandwidth measurements.
