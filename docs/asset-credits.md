# Asset credits

Everything from an asset pack is **CC0 1.0 (public domain)** — free for personal, educational and commercial use,
with no attribution required. Credit is given here anyway because the packs are worth pointing at. Project-original
art is listed separately below.

Original game names, characters and Ougi designs are ours; nothing here is from Nindou.

AI-generated art is allowed for brand art and for single fixed-size in-game images (portraits, icons, banners,
backdrops); sprite sheets and arena tiles stay code-drawn or CC0, because those must hold a grid and a palette
across frames (see `CLAUDE.md`). Note that purely
AI-generated images can't be registered for copyright in some jurisdictions, including the US — it doesn't
stop you shipping them, but it does mean the logo may not be an asset you can defend as exclusively yours.

## Art

| File | Source |
|---|---|
| `packages/client/public/assets/sprites/ninja.png` | [Roguelike Characters](https://kenney.nl/assets/roguelike-characters) by [Kenney](https://kenney.nl) — one 16x16 frame from the pack's spritesheet, recolored per character at runtime |
| `packages/client/public/logo.webp`, `favicon.png` | Project brand logo — AI-generated, supplied by the author. Sources kept out of the bundle in `packages/client/brand/`: `logo-source-v2.png` is the shipped design (1024px RGBA, already cut out); `logo-source.png` is the superseded first version. The shipped files are trimmed to the artwork's bounding box and downscaled — no masking needed on v2 |

Everything else on screen is drawn in code at runtime, so there are no files to credit: weapon icons
(`src/ui/weapon-icon.ts`), map thumbnails (`src/ui/map-thumb.ts`), character portraits (`src/ui/portrait.ts`),
the arena's floor/pillar/wall textures (`src/scenes/GameScene.ts`), and every combat effect — per-weapon swing
shapes, Ougi rings and beams, impact marks, shards and particles (`src/scenes/effects.ts`).

M8's optional AI art swap (S25.5) was deliberately skipped, so the logo below remains the only generated image
in the project.

## Fonts

| Font | Where | License |
|---|---|---|
| [Anton](https://fonts.google.com/specimen/Anton) | `--font-display`: the wordmark fallback, section labels, HUD readouts, overlay titles | [SIL Open Font License 1.1](https://openfontlicense.org) — served from Google Fonts |

Body copy uses the `system-ui` stack, so nothing else is loaded.

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
