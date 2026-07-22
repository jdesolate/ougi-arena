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

## S3 — Phaser renderer + skin layer + drag input (2026-07-23)

- `GameScene` runs the shared sim locally (one controllable ninja, `DOJO_ARENA`), stepping it on a fixed 1/30s accumulator decoupled from Phaser's variable frame delta (capped at 5 steps/frame to avoid a stall spiral).
- Renders walls, the destructible obstacle grid (color fades toward its "cracked" tone as `hp` drops, vanishes on `alive:false`), and the ninja via a small data-driven `skins.ts` table (`characterId` → color) so a real asset pack later is a data swap, not a scene rewrite.
- Pointer input: press-and-hold within a grab radius (2.5x ninja radius) starts a slingshot drag; move draws a pull line plus a power-scaled launch preview; release computes direction (opposite the drag) and power (drag distance / 160, clamped 0..1) into a `LaunchCommand` consumed by the next fixed step.
- `main.ts` now boots `GameScene` sized to the arena (1280x720) with `Scale.FIT`. Added `.claude/launch.json` for browser-preview verification; dropped the hardcoded port in `vite.config.ts` so it can fall back cleanly when 5173 is taken.
- Verified in-browser: ninja renders at spawn, drag-launch fires it the correct opposite direction, it smashes an obstacle out of the grid and settles after wall bounces — matches S2's collision/damping behavior. No console errors.
- `pnpm typecheck` and `pnpm lint` pass across all packages.
- **Correction after review:** Nindou's original dashes are axis-locked (no diagonals). Added `snapToCardinal` in `GameScene` so the launch direction snaps to the nearest of up/down/left/right; updated FR-8 in `docs/prd.md` and the core-gameplay bullet in `docs/mvp-plan.md` to record the decision. Re-verified in-browser: a straight-down drag launches purely on the y-axis (bounces off the top wall and returns along the same x-column), a diagonal-ish drag resolves to a single dominant axis — no diagonal drift in either case.
- **Second correction after review:** the ballistic overshoot/bounce didn't match Nindou either — a dash should travel exactly to the drag's target point (TP-capped range), hard-stopping the instant it touches a wall or obstacle rather than bouncing past it. Reworked the shared sim: `NinjaState` gained `dashBudget` (world units left in the current dash), `applyLaunch` sets it from `power * MAX_DASH_DISTANCE` (new constant, a placeholder for real TP until S6), `integrate()` clips per-tick movement to it, and `collision.ts`'s `resolveStaticContact` (bounce) was replaced with `stopAtContact` (full halt, dash ends) used by both wall and obstacle collision — obstacles now always stop the dash, whether or not the hit breaks them. `WALL_RESTITUTION`/`OBSTACLE_RESTITUTION` removed (unused); `NINJA_RESTITUTION` untouched. Rewrote the 5 affected sim/collision unit tests for the new stop-not-bounce behavior; all 27 tests pass. Client's aim-preview line now shows the true landing distance (`power * MAX_DASH_DISTANCE`) instead of an arbitrary cosmetic length. Verified via direct sim inspection (no screenshot access this pass — browser pane wasn't displayable) that: a partial-power dash in open space stops at exactly the predicted distance, a full-power dash into a wall halts instantly with no drift, and a full-power dash into an obstacle shatters it but still halts at the contact point instead of carrying through.
- **Deferred, documented, not implemented:** passing through an enemy ninja mid-dash should shatter (instant-KO) them instead of bouncing, with random-point respawn at reduced HP, blink invulnerability, and a smoke effect. Needs the HP/KO system, which doesn't exist yet — recorded in `prd.md` (FR-9/FR-11) and `mvp-plan.md`, to be built properly in S6 (HP/KO/respawn/invulnerability) and S10 (smoke/blink juice) rather than bolted on early. Ninja-vs-ninja collision still uses the old elastic knockback in the meantime.
- **Next:** S4 — Colyseus rooms + lobby: create/join by link code, public/private flag, nickname flow, host start + migration, spectate-on-mid-join, reconnection via `allowReconnection`. Model: Sonnet.
- **Open issues:** none.

## S4 — Colyseus rooms + lobby (2026-07-23)

- `ArenaRoom` rewritten as a lobby: `LobbyState` (`phase: "lobby" | "playing"`) with a `MapSchema<PlayerState>` (`nickname`, `characterId`, `isHost`, `spectating`). Join code is Colyseus's own `roomId` — no custom code generator needed. `setPrivate` from a create option covers the public/private toggle.
- Active combatants capped at 4 (`MAX_ACTIVE_PLAYERS`); `maxClients` raised to 8 so the room keeps accepting joiners past that as spectators instead of rejecting them. Anyone joining while `phase === "playing"`, or past the active-player cap, is flagged `spectating`.
- Host is the first joiner; `"start"` message is host-only and flips `phase` to `"playing"`. On host disconnect, `migrateHost()` hands it to the oldest remaining joiner via a tracked `joinOrder` array (not `this.clients`, which colyseus doesn't guarantee stays in join order).
- `onLeave`: unintentional drops (`consented === false`) get a 20s `allowReconnection` grace window before the player is removed; explicit leaves remove immediately.
- Client: new `lobby.ts` + a DOM overlay in `index.html` (nickname, private toggle, create/join-by-code, live player list, host-only start button, spectate note) ahead of the existing local-sim `GameScene`. `network/colyseus.ts` holds the `Client` instance (hardcoded `ws://localhost:2567` — env-based config is S11). `/r/<code>` in the URL prefills the join code; `history.replaceState` writes it back after create/join. Reconnection token is persisted to `localStorage` and retried on load before showing the lobby form.
- `GameScene` itself is untouched — still runs its own local sim standalone. Wiring the room's authoritative state into it is S5.
- Verified in-browser with 3 tabs against a real server: create → room code shown, host tagged; join-by-code from the URL path picks up nickname + live player list on both sides; host-only "Start match" button; starting flips both tabs from lobby to the Phaser canvas; a third tab joining after start is correctly flagged spectating with the note shown. No console errors in any tab.
- `pnpm typecheck` and `pnpm lint` pass across all packages.
- **Next:** S5 — Authoritative room: shared sim at 30Hz, schema state sync, client interpolation (~100ms) + optimistic local launch; two tabs can fight. Model: Opus.
- **Open issues:** none.
