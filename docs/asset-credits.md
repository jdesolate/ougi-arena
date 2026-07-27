# Asset credits

Everything from an asset pack is **CC0 1.0 (public domain)** — free for personal, educational and commercial use,
with no attribution required. Credit is given here anyway because the packs are worth pointing at. Project-original
art is listed separately below.

Original game names, characters and Ougi designs are ours; nothing here is from Nindou.

## Art

| File | Source |
|---|---|
| `packages/client/public/assets/sprites/ninja.png` | [Roguelike Characters](https://kenney.nl/assets/roguelike-characters) by [Kenney](https://kenney.nl) — one 16x16 frame from the pack's spritesheet, recolored per character at runtime |
| `packages/client/public/logo.png` | Project brand logo, supplied by the author — **provenance to be recorded here before ship** (`docs/m8-plan.md` commits the project to original/CC0 art only) |

Weapon icons, map thumbnails, character portraits and every arena texture are drawn in code at runtime
(`src/ui/weapon-icon.ts`, `src/ui/map-thumb.ts`, `src/ui/portrait.ts`, `src/scenes/GameScene.ts`) — no files to credit.

## Audio

Every sound below is from a [Kenney](https://kenney.nl) pack, renamed to its role in the game:
[Impact Sounds](https://kenney.nl/assets/impact-sounds) and [Interface Sounds](https://kenney.nl/assets/interface-sounds).

| File | Plays on | Original |
|---|---|---|
| `dash.ogg` | slingshot launch | `impactSoft_medium_000` |
| `hit.ogg` | ninja takes damage | `impactPunch_medium_000` |
| `wall.ogg` | dash stops on a wall | `impactWood_light_000` |
| `break.ogg` | obstacle destroyed | `impactGlass_heavy_000` |
| `ko.ogg` | shatter KO | `impactPunch_heavy_000` |
| `ougi-ember.ogg` | Ember fires Shockwave | `impactMining_000` |
| `ougi-gale.ogg` | Gale fires Surge | `maximize_004` |
| `ougi-shade.ogg` | Shade fires Cross Slash | `impactMetal_light_000` |
| `countdown.ogg` | each of the last 5 seconds | `tick_002` |
| `match-start.ogg` | match begins | `confirmation_001` |
| `match-end.ogg` | match ends | `bong_001` |
| `select.ogg` | picking a character | `select_003` |
