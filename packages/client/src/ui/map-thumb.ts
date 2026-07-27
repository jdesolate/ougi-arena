import { CELL, type Aabb, type ArenaMap } from "@ougi-arena/shared";
import { cssColor } from "../skins.js";
import {
  COLOR_BORDER,
  COLOR_FLOOR,
  COLOR_FLOOR_TILE,
  COLOR_OBSTACLE_FRESH,
  COLOR_PILLAR_BODY_DARK,
  COLOR_PILLAR_TOP,
  COLOR_SHADOW,
  COLOR_SPAWN,
  SHADOW_ALPHA,
} from "../world-palette.js";

/** Thumbnail pixels per arena cell. Small enough to stay a glanceable shape, big enough to see a 1-cell choke. */
const CELL_PX = 8;

/** The arena's real 7x9 shadow offset is sub-pixel at this scale, so the whole faux-depth read is 1px here. */
const THUMB_OFFSET = 1;
/** Pillar top faces sit this far above their own cell, the thumbnail's stand-in for S20's 52px rise. */
const THUMB_RISE = 2;

/**
 * Draws an arena at thumbnail scale straight from its own geometry, so a new ASCII map gets a picker card for
 * free. The canvas is upscaled by CSS with `image-rendering: pixelated` rather than drawn large.
 *
 * It reproduces the arena's faux depth in miniature — tiled floor, cast shadows, pillars as a dark body under
 * a raised lit top — because a card that reads flat would be advertising a different-looking arena.
 */
export function drawMapThumb(canvas: HTMLCanvasElement, map: ArenaMap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const scale = CELL_PX / CELL;
  canvas.width = Math.round(map.width * scale);
  canvas.height = Math.round(map.height * scale);

  const box = (b: Aabb, dx = 0, dy = 0): void => {
    ctx.fillRect(
      Math.round((b.x - b.halfW) * scale) + dx,
      Math.round((b.y - b.halfH) * scale) + dy,
      Math.round(b.halfW * 2 * scale),
      Math.round(b.halfH * 2 * scale),
    );
  };

  ctx.fillStyle = cssColor(COLOR_FLOOR);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Same grid the sim snaps dashes to, so the tile a dash lands on is legible before the match starts.
  ctx.fillStyle = cssColor(COLOR_FLOOR_TILE);
  for (let row = 0; row < map.grid.rows; row++) {
    for (let col = 0; col < map.grid.cols; col++) {
      const x = Math.round((map.grid.originX + col * CELL) * scale);
      const y = Math.round((map.grid.originY + row * CELL) * scale);
      ctx.fillRect(x, y, CELL_PX - 1, CELL_PX - 1);
    }
  }

  ctx.fillStyle = cssColor(COLOR_BORDER);
  for (const wall of map.border) box(wall);

  // One light, one shadow — everything standing above the floor drops the same offset smudge.
  ctx.globalAlpha = SHADOW_ALPHA;
  ctx.fillStyle = cssColor(COLOR_SHADOW);
  for (const pillar of map.pillars) box(pillar, THUMB_OFFSET, THUMB_OFFSET);
  for (const obstacle of map.obstacles) box(obstacle, THUMB_OFFSET, THUMB_OFFSET);
  ctx.globalAlpha = 1;

  // Body first, then the top face raised out of it: the overhang is what says "tall cover" at 8px.
  ctx.fillStyle = cssColor(COLOR_PILLAR_BODY_DARK);
  for (const pillar of map.pillars) box(pillar);
  ctx.fillStyle = cssColor(COLOR_PILLAR_TOP);
  for (const pillar of map.pillars) box(pillar, 0, -THUMB_RISE);

  ctx.fillStyle = cssColor(COLOR_OBSTACLE_FRESH);
  for (const obstacle of map.obstacles) box(obstacle);

  // Spawns matter to the read: they say how far apart the four of you start.
  ctx.fillStyle = cssColor(COLOR_SPAWN);
  for (const spawn of map.spawns) {
    ctx.fillRect(Math.round(spawn.x * scale) - 1, Math.round(spawn.y * scale) - 1, 2, 2);
  }
}
