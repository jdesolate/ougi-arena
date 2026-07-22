# Ougi Arena — Product Requirements Document

**Status:** pre-development · **Owner:** Merv · **Last updated:** 2026-07-23
**Companion docs:** [mvp-plan.md](mvp-plan.md) (decisions, milestones, session plan)

## 1. Overview

Ougi Arena is a real-time multiplayer browser game inspired by the defunct browser brawler Nindou. Chibi ninjas slingshot-dash around a destructible arena in short free-for-all matches, charging an ultimate move (Ougi) by dealing damage.

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
- More than one arena map.

## 3. Target users

1. **The author and friends** playing casual matches via Quick Play or shared links.
2. **Invited strangers** (communities, social posts) who should get into a fun match with zero instructions.
3. **Recruiters/engineers** skimming the README and demo video (secondary).

## 4. Functional requirements

### 4.1 Rooms and lobby
- FR-1: Create a room from the landing page (public by default, private toggle); receive a shareable URL (`/r/<code>`).
- FR-2: Join via link, Quick Play (auto-joins an open public room or creates one), or the public room list on the landing page.
- FR-3: Join flow asks only for a nickname (free text, length-capped) and character selection.
- FR-4: Rooms hold 2–4 players; host starts the match; host migrates to the oldest player on disconnect.
- FR-5: Mid-match joiners spectate until the next match; rematch button restarts within the same room.
- FR-6: Rooms live in server memory only and are destroyed when empty.
- FR-7: A disconnected player (network blip, tab/phone sleep) can rejoin the same live match within a grace window (~30s) with their state intact.

### 4.2 Core gameplay
- FR-8: Slingshot movement — press on own ninja (generous grab radius), drag back, release to launch. Movement consumes TP, which regenerates over time.
- FR-9: Ballistic dashes with damping; ninjas collide physically with each other (knockback), walls, and obstacles.
- FR-10: Destructible obstacle grid; obstacles have HP, shatter when dashed through, do not respawn within a match.
- FR-11: Damage on ninja-vs-ninja hits; HP depletion causes KO; ~3s respawn with ~2s invulnerability.
- FR-12: SP charges only by dealing damage; at max SP the player may fire their character's Ougi.
- FR-13: 3–4 selectable characters, identical base stats, each defined by one unique Ougi.
- FR-14: Matches are 2-minute timed kill-count; scoreboard at the end; sudden-death next-KO on ties.

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

## 8. Post-MVP roadmap

Ordered by expected value for making the game more fun and more shared. None of these are commitments.

### Phase 1 — Feel and reach
- **Rewind-replay prediction** for own ninja, if the S9 latency pass showed it's needed at real-world pings.
- **Proper mobile pass**: responsive lobby, touch-sized UI, orientation handling, mobile performance budget — phones are how casual friends will join.
- **Room passwords** and basic profanity filtering as strangers arrive.

### Phase 2 — Depth
- **Team mode: Save the Princess** — 2v2 objective mode faithful to Nindou's flagship (barriers, objective HP, team assignment).
- **More characters/Ougis** (target 6–8) and a second arena map (map system is data-driven from MVP).
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
