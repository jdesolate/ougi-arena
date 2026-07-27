# Ougi Arena — M8: Visual/UX Overhaul (post-MVP milestone)

## Context

The MVP shipped (S1–S17, live at ougi-arena.j-desolate53.workers.dev). This milestone is a full visual and functional overhaul across the three screens (homepage, lobby, arena) toward a modern-retro Japanese console aesthetic, plus weapon attack animations, hit feedback, an arcade HUD, and pause/quit game-loop controls.

**Decisions made with the user:**
1. **No true isometric projection.** Keep the top-down grid; deepen the existing faux-depth (taller pillars with cast shadows, wall faces, tile texturing, stronger `ySortDepth` occlusion). The sim and input math stay untouched.
2. **One sim change is in scope:** fan (tessen) knockback — push the hit target 1 tile. Longsword's "cleaves light cover in one hit" is already effectively true (20 dmg vs hay's 16 HP); kunai already matches its spec. Opus session per model policy.
3. **In-game art = code-drawn runtime textures + CC0 packs** (Kenney etc., credited in `docs/asset-credits.md`). Still no AI-generated sprite sheets — AI can't hold a consistent palette or grid across 16x16 frames, and every arena texture is already generated in code. **Brand/marketing art (logo, social images) may be AI-generated** — revised 2026-07-27 at the user's request; the landing-page logo is the first such asset.

**Current-state facts the sessions rely on:**
- All UI is DOM overlays in one `index.html` `<style>` block — no CSS tokens. Screens: `#lobby` (form + room views), `#hud` top bar, `#match-end`.
- Arena renders via per-frame `Graphics` in `GameScene.drawWorld()`; ninjas are single tinted 16x16 Kenney sprites (`skins.ts`); pillars are runtime-generated textures with 34px top-face rise and Y-sort occlusion; particles in `scenes/effects.ts`. `world-palette.ts` is the single color table shared with `ui/map-thumb.ts` and `ui/portrait.ts`.
- Weapons have **no real animations** — `GameScene.weaponEffect()` is a particle burst per cell + squash tween. No knockback on any weapon today (knockback machinery exists in Shockwave's `dashBudget` push and `collision.ts` `KNOCKBACK_BONUS`).
- **No pause/Esc/quit exists.** Lobby→game is one-way (`lobbyEl.hidden = true`, Phaser game never destroyed, URL pinned at `/r/<code>`). Match-end offers only host rematch. HP is shown only as the over-sprite bar, never in the HUD.

## Sequencing rationale

- **Tokens first (S18)** — every later UI session consumes the design vocabulary instead of inventing colors.
- **Arena depth (S20) before the HUD rebuild (S22)** — taller pillars change canvas composition/margins the bottom HUD must fit around.
- **Fan knockback (S23, Opus) paired immediately with its visualization (S24, Sonnet)** — same S14/S15 pattern: a sim change is never left unplayable across a context reset.
- **Pause/quit (S25) last among structural changes** — riskiest session (first-ever teardown path); nothing else depends on it, so a failure can't block cosmetic sessions.
- **S26 polish/ship-check** absorbs cross-screen inconsistencies, like S17 did for M7.

## Session table

| # | Deliverable | Model | Key files | Depends on |
|---|---|---|---|---|
| S18 | **Design system**: extract CSS custom properties into a `:root` token block (ink-wash blues/dark slate surfaces, gold accent `--gold`, `--hp-red`, `--chakra-blue`); build framed wood/lacquer component classes (panel frame with metallic corner plates, recessed input, arcade button, card, gauge track/fill); re-express existing `#lobby`/`#hud`/`#match-end` styles in tokens with no layout change beyond the palette shift; extract the style block to `src/style.css`; document the token ↔ `world-palette.ts` mapping so DOM and canvas can't drift | Sonnet | `packages/client/index.html`, new `packages/client/src/style.css`, `packages/client/src/world-palette.ts` (reference) | — |
| S19 | **Homepage arcade layout**: 2-column landing — left = ninja + weapon select as pixel-art cards (portraits via `ui/portrait.ts`; weapon cards gain drawn icons; selected card gets glowing gold border + lift), right = nickname, Quick Play, private-room controls with recessed inputs; responsive collapse preserving the S16 mobile pass | Sonnet | `index.html`, `src/lobby.ts`, `src/ui/portrait.ts` | S18 |
| S20 | **Arena faux-depth pass**: taller pillar textures (raise the 34px overhang), cast shadows under pillars/ninjas/obstacles, wall faces on the border, floor tile texturing per map palette — all runtime-generated textures + optional Kenney CC0 tiles; no sim geometry change, 15x8 canvas size unchanged | Sonnet | `src/scenes/GameScene.ts` (`drawWorld`, `createPillars`), `src/world-palette.ts`, `src/skins.ts` | — (parallel-safe with S18/S19) |
| S21 | **Lobby room view**: player badges (portrait + nickname + weapon + host/bot markers), woodblock-framed map cards upgrading `ui/map-thumb.ts` (frame, title plaque — thumbnail still derives from map geometry), glowing match-config summary under the start button | Sonnet | `index.html`, `src/lobby.ts`, `src/ui/map-thumb.ts` | S18 (palette tweaks from S20 if any) |
| S22 | **Arcade HUD rebuild**: bottom lacquer-framed bar — red HP gauge (**new plumbing: HP must be threaded from `NinjaSchema.hp` into the DOM HUD via `renderHud()`**), blue TP/SP gauges, weapon/skill frame with draining cooldown, restyled ougi button; compact top-center capsule with timer + alive counter; keep the over-sprite HP bar; restyle `#match-end` to match | Sonnet | `index.html`, `src/scenes/GameScene.ts` (`renderHud`, `renderMatchEnd`) | S18, S20 |
| S23 | **Fan knockback in the sim**: per-weapon `knockbackCells` field in `shared/weapon.ts` (fan 1, others 0); on hit, push the victim 1 cell along the swing direction via the existing `dashBudget` push path (Shockwave precedent, `dashLethal` stays false), hard-stopping on walls/obstacles, cell-aligned landing; `ninjaDamaged`/event payload gains knockback info; unit tests: push distance, wall clamp, off-grid realignment, no knockback for kunai/longsword, invulnerable target, determinism | **Opus** | `packages/shared/src/weapon.ts`, `sim.ts`, `constants.ts`, `weapon.test.ts`; verify client reconciliation tolerates a server-initiated push of the *local* player (S9 snap-back gating) | ship with S24 |
| S24 | **Weapon attack visualizations + hit feedback**: replace generic `weaponEffect()` with per-weapon animations — kunai stab lunge + white streak, fan wind-sweep + swirl particles, longsword glowing red/silver arc across both cells; impact spark/slash mark at every hit point; wobble tween then pixel-shatter on destructibles; knockback slide + dust for fan victims; 0ms optimistic swing preserved | Sonnet | `src/scenes/effects.ts`, `src/scenes/GameScene.ts` (`weaponEffect`, `handleSimEvents`), `src/world-palette.ts` | S23 |
| S25 | **Game-loop controls (riskiest)**: Esc (window-level listener, not Phaser) + top-right button → framed pause modal (Resume / Settings / Quit to Home; pause is UI-only — the authoritative sim never stops); real teardown path: consented `room.leave()`, unhook schema/DOM listeners, `game.destroy(true)`, restore URL to `/`, re-show a clean lobby, support a fresh join afterward; match-end gains "Exit to Main Menu" for everyone incl. non-hosts alongside host rematch | Sonnet (escalate to Opus if room-lifecycle bugs surface) | `src/main.ts`, `src/lobby.ts`, `index.html`, `src/scenes/GameScene.ts`; possibly server `onLeave` handling | after all other client sessions |
| S26 | **Polish + ship check**: cross-screen consistency sweep (token stragglers, focus states), re-run the mobile pass against the new bottom HUD, `docs/asset-credits.md` update, production deploy + smoke test, README refresh | Sonnet | flagged files from S18–S25, `README.md`, docs | all |

## Risks

- **S25 teardown**: client assumes a game is never destroyed. Hazards: `allowReconnection` holding a ghost seat on a deliberate quit (needs consented leave), dangling Phaser RAF/listeners after `game.destroy()`, stale module-level state into the next join. Budget spillover to a second session; commit the pause overlay separately from the teardown.
- **S23 knockback vs reconciliation**: a server push of the local player at rest is a new case for S9's snap-back gating — must be verified explicitly.
- **HP-in-HUD is new plumbing**, not just styling (flagged in S22).
- **Verification constraint**: the Browser pane historically can't composite frames (S6–S17); live checks use the established `window.__scene` hook (always reverted before commit) + DOM inspection; sim behavior relies on the vitest suite (106 tests today).
- **Scope-cut levers, in order**: wobble-shatter (S24) → floor tile texturing (S20) → Settings entry in the pause modal (ship Resume/Quit only).

## Per-session workflow (unchanged from MVP)

Each session: one deliverable, `pnpm typecheck` + `pnpm lint` (+ `pnpm test` when shared is touched) green, one commit, 3–5 line `docs/activity-log.md` entry. This plan should also be appended to `docs/mvp-plan.md` (or a new `docs/m8-plan.md`) as the M8 session table in the first session (S18).
