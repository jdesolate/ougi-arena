import { CELL, type Aabb, type ArenaMap } from "@ougi-arena/shared";
import { cssColor } from "../skins.js";
import {
  COLOR_BORDER,
  COLOR_FLOOR,
  COLOR_OBSTACLE_FRESH,
  COLOR_PILLAR_TOP,
  COLOR_SPAWN,
} from "../world-palette.js";

/** Thumbnail pixels per arena cell. Small enough to stay a glanceable shape, big enough to see a 1-cell choke. */
const CELL_PX = 6;

/**
 * Draws an arena at thumbnail scale straight from its own geometry, so a new ASCII map gets a picker card for
 * free. The canvas is upscaled by CSS with `image-rendering: pixelated` rather than drawn large.
 */
export function drawMapThumb(canvas: HTMLCanvasElement, map: ArenaMap): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const scale = CELL_PX / CELL;
  canvas.width = Math.round(map.width * scale);
  canvas.height = Math.round(map.height * scale);

  const box = (b: Aabb): void => {
    ctx.fillRect(
      Math.round((b.x - b.halfW) * scale),
      Math.round((b.y - b.halfH) * scale),
      Math.round(b.halfW * 2 * scale),
      Math.round(b.halfH * 2 * scale),
    );
  };

  ctx.fillStyle = cssColor(COLOR_FLOOR);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = cssColor(COLOR_BORDER);
  for (const wall of map.border) box(wall);

  ctx.fillStyle = cssColor(COLOR_PILLAR_TOP);
  for (const pillar of map.pillars) box(pillar);

  ctx.fillStyle = cssColor(COLOR_OBSTACLE_FRESH);
  for (const obstacle of map.obstacles) box(obstacle);

  // Spawns matter to the read: they say how far apart the four of you start.
  ctx.fillStyle = cssColor(COLOR_SPAWN);
  for (const spawn of map.spawns) {
    ctx.fillRect(Math.round(spawn.x * scale) - 1, Math.round(spawn.y * scale) - 1, 2, 2);
  }
}
